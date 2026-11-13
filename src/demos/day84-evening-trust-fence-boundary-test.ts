import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { SQLiteRecoveryWriterTrustWatermarkStore } from "../runtime/recovery-writer-sqlite-trust-watermark-store.js";
import { RecoveryWriterTrustFenceConflict } from "../runtime/recovery-writer-transactional-trust-contract.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const dir = mkdtempSync(join(tmpdir(), "day84-evening-"));
const file = join(dir, "recovery.sqlite");
const now = Date.UTC(2026, 10, 13, 10);
const deploymentId = "stage:day84-evening";
const stamp = (revision: number, digit: string) => ({
  deploymentId, revision, policySha256: digit.repeat(64)
});
const v7 = stamp(7, "a"), v8 = stamp(8, "b");
const consumer = {
  durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
};
const record = (id: string): RecoveryOutboxRecord => ({
  id: "cmd:" + id, eventId: "event:" + id,
  commandId: "cmd:" + id, runId: "run:84",
  kind: "audit", payload: "{}", status: "pending",
  attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
});
const db = new DatabaseSync(file);
db.exec(RECOVERY_FINALIZATION_SCHEMA);
const first = record("first"), second = record("second");
const third = record("third"), legacyRecord = record("legacy");
for (const r of [first, second, third, legacyRecord]) {
  db.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
    .run(r.id, r.eventId, r.commandId, r.runId, JSON.stringify(r), r.createdAt);
}
const authority = new SQLiteRecoveryWriterTrustWatermarkStore(file);
assert.equal(authority.provisionTrustedAnchor(v7), true);
const old = new SQLiteFencedOutboxDelivery(file, { activeTrustWatermark: v7 });
const current = new SQLiteFencedOutboxDelivery(file, { activeTrustWatermark: v8 });
const denied = (fn: () => unknown) => assert.throws(
  fn, (error: unknown) => error instanceof RecoveryWriterTrustFenceConflict
    && error.reason === "stale_trust_revision_fenced"
);
const fenceEpoch = () => (db.prepare(
  "SELECT epoch FROM recovery_writer_fence WHERE scope='outbox'"
).get() as {epoch: number}).epoch;
try {
  const epochA = old.rotate("worker-A");
  const claimA = old.claim({
    outboxId: first.id, workerId: "worker-A", epoch: epochA,
    consumer, nowEpochMs: now, leaseMs: 5000
  });
  assert.equal(claimA.action, "claimed");
  if (claimA.action !== "claimed") throw Error("missing first lease");

  // A simulated crash after an uncommitted policy update must roll back.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE recovery_writer_trust_watermarks SET revision=?,policy_sha256=? WHERE deployment_id=?"
    ).run(8, v8.policySha256, deploymentId);
    throw Error("simulated_crash_before_commit");
  } catch (error) {
    db.exec("ROLLBACK");
    assert.equal((error as Error).message, "simulated_crash_before_commit");
  }
  assert.equal((await authority.load(deploymentId))?.revision, 7);
  // A committed policy update must serialize before the next writer operation.
  assert.equal(await authority.compareAndSwap(v7, v8), "advanced");
  const beforeEpoch = fenceEpoch();
  denied(() => old.rotate("worker-A"));
  assert.equal(fenceEpoch(), beforeEpoch);
  denied(() => old.claim({
    outboxId: second.id, workerId: "worker-A", epoch: epochA,
    consumer, nowEpochMs: now + 1, leaseMs: 5000
  }));
  denied(() => old.acknowledge({
    outboxId: first.id, eventId: first.eventId, workerId: "worker-A",
    epoch: epochA, leaseToken: claimA.leaseToken, nowEpochMs: now + 2
  }));
  assert.equal(old.inspect(first.id)?.status, "pending");
  assert.equal(old.inspect(second.id)?.attempts, 0);

  const epochB = current.rotate("worker-B");
  assert.equal(epochB, epochA + 1);
  const claimB = current.claim({
    outboxId: second.id, workerId: "worker-B", epoch: epochB,
    consumer, nowEpochMs: now + 3, leaseMs: 5000
  });
  assert.equal(claimB.action, "claimed");
  if (claimB.action !== "claimed") throw Error("missing second lease");
  assert.equal(current.acknowledge({
    outboxId: second.id, eventId: second.eventId,
    workerId: "worker-B", epoch: epochB, leaseToken: claimB.leaseToken,
    nowEpochMs: now + 4
  }).action, "dispatched");

  // Restart with the trusted active revision: guarded APIs still work.
  current.close();
  const restarted = new SQLiteFencedOutboxDelivery(file, { activeTrustWatermark: v8 });
  try {
    const fresh = restarted.claim({
      outboxId: third.id, workerId: "worker-B", epoch: epochB,
      consumer, nowEpochMs: now + 5, leaseMs: 5000
    });
    assert.equal(fresh.action, "claimed");
  } finally {
    restarted.close();
  }

  // Negative security proof: legacy constructor bypasses the optional fence.
  const legacy = new SQLiteFencedOutboxDelivery(file);
  try {
    const legacyEpoch = legacy.rotate("legacy-worker");
    const result = legacy.claim({
      outboxId: legacyRecord.id, workerId: "legacy-worker",
      epoch: legacyEpoch, consumer, nowEpochMs: now + 6, leaseMs: 5000
    });
    assert.equal(result.action, "claimed");
  } finally {
    legacy.close();
  }
  // Critical negative proof: a legacy direct SQL connection can still forge
  // a dispatched status without invoking claim/ack or validating trust/ACK.
  const pending = old.inspect(first.id);
  assert.ok(pending);
  db.prepare("UPDATE recovery_outbox SET payload=? WHERE id=?").run(
    JSON.stringify({ ...pending, status: "dispatched", version: pending.version + 1 }),
    first.id
  );
  assert.equal(old.inspect(first.id)?.status, "dispatched");
  console.log("PASS Day 84 evening: rollback, stale rotate/claim/ACK, restart, explicit legacy and direct-SQL bypass; production NO_GO");
} finally {
  old.close();
  try { current.close(); } catch { /* already closed during restart */ }
  authority.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
