import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { SQLiteRecoveryWriterTrustWatermarkStore } from "../runtime/recovery-writer-sqlite-trust-watermark-store.js";
import { RecoveryWriterTrustFenceConflict } from "../runtime/recovery-writer-transactional-trust-contract.js";

const dir = mkdtempSync(join(tmpdir(), "day84-trust-tx-"));
const path = join(dir, "writer.sqlite");
const now = Date.UTC(2026, 10, 13, 4);
const deploymentId = "stage:day84";
const watermark = (revision: number, hex: string) =>
  ({ deploymentId, revision, policySha256: hex.repeat(64) });
const v7 = watermark(7, "a"), v8 = watermark(8, "b");
const consumer = {
  durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
};
const record = (suffix: string): RecoveryOutboxRecord => ({
  id: "cmd:" + suffix, eventId: "event:" + suffix,
  commandId: "cmd:" + suffix, runId: "run:84",
  kind: "audit", payload: "{}", status: "pending", attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
});
function seed(db: DatabaseSync, r: RecoveryOutboxRecord): void {
  db.prepare(
    "INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)"
  ).run(r.id, r.eventId, r.commandId, r.runId, JSON.stringify(r), r.createdAt);
}
function rejected(fn: () => unknown, reason: string): void {
  assert.throws(fn, (e: unknown) => e instanceof RecoveryWriterTrustFenceConflict && e.reason === reason);
}
const admin = new DatabaseSync(path);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
const first = record("pre-revoke"), second = record("post-revoke");
seed(admin, first);
seed(admin, second);
const authority = new SQLiteRecoveryWriterTrustWatermarkStore(path);
assert.equal(authority.provisionTrustedAnchor(v7), true);
const oldWriter = new SQLiteFencedOutboxDelivery(path, { activeTrustWatermark: v7 });
const newWriter = new SQLiteFencedOutboxDelivery(path, { activeTrustWatermark: v8 });
const badDigest = new SQLiteFencedOutboxDelivery(path, {
  activeTrustWatermark: watermark(8, "c")
});
const missingDeployment = new SQLiteFencedOutboxDelivery(path, {
  activeTrustWatermark: { ...v8, deploymentId: "missing:deployment" }
});
try {
  const epoch = oldWriter.rotate("worker-A");
  // Transaction A acquires SQLite write lock and commits claim before revocation B.
  const claimed = oldWriter.claim({
    outboxId: first.id, workerId: "worker-A", epoch, consumer,
    nowEpochMs: now, leaseMs: 3000
  });
  assert.equal(claimed.action, "claimed");
  if (claimed.action !== "claimed") throw Error("claim not issued");
  assert.equal(oldWriter.inspect(first.id)?.attempts, 1);

  // Transaction B advances the watermark using another SQLite connection.
  assert.equal(await authority.compareAndSwap(v7, v8), "advanced");
  assert.equal((await authority.load(deploymentId))?.revision, 8);

  // Both old Claim and old ACK must be denied INSIDE their own write transactions.
  rejected(() => oldWriter.acknowledge({
    outboxId: first.id, eventId: first.eventId, workerId: "worker-A",
    epoch, leaseToken: claimed.leaseToken, nowEpochMs: now + 20
  }), "stale_trust_revision_fenced");
  rejected(() => oldWriter.claim({
    outboxId: second.id, workerId: "worker-A", epoch, consumer,
    nowEpochMs: now + 20, leaseMs: 3000
  }), "stale_trust_revision_fenced");
  assert.equal(oldWriter.inspect(first.id)?.status, "pending");
  assert.equal(oldWriter.inspect(second.id)?.attempts, 0);
  assert.equal(oldWriter.inspect(second.id)?.version, 1);

  // New trusted snapshot can ACK existing verified lease and Claim a new row.
  assert.equal(newWriter.acknowledge({
    outboxId: first.id, eventId: first.eventId, workerId: "worker-A",
    epoch, leaseToken: claimed.leaseToken, nowEpochMs: now + 30
  }).action, "dispatched");
  const next = newWriter.claim({
    outboxId: second.id, workerId: "worker-A", epoch, consumer,
    nowEpochMs: now + 40, leaseMs: 3000
  });
  assert.equal(next.action, "claimed");
  if (next.action !== "claimed") throw Error("new claim not issued");
  assert.equal(newWriter.acknowledge({
    outboxId: second.id, eventId: second.eventId, workerId: "worker-A",
    epoch, leaseToken: next.leaseToken, nowEpochMs: now + 50
  }).action, "dispatched");

  rejected(() => badDigest.claim({
    outboxId: second.id, workerId: "worker-A", epoch, consumer,
    nowEpochMs: now + 60, leaseMs: 3000
  }), "trust_policy_digest_mismatch");
  rejected(() => missingDeployment.acknowledge({
    outboxId: second.id, eventId: second.eventId, workerId: "worker-A",
    epoch, leaseToken: next.leaseToken, nowEpochMs: now + 60
  }), "transactional_watermark_unavailable");

  // Different DB has NO trust table: never fall back to a separate connection.
  const isolated = join(dir, "unrelated-outbox.sqlite");
  const isolatedWriter = new SQLiteFencedOutboxDelivery(isolated, {
    activeTrustWatermark: v8
  });
  try {
    const localEpoch = isolatedWriter.rotate("worker-A");
    assert.throws(() => isolatedWriter.claim({
      outboxId: second.id, workerId: "worker-A", epoch: localEpoch, consumer,
      nowEpochMs: now + 70, leaseMs: 3000
    }), /no such table: recovery_writer_trust_watermarks/);
  } finally {
    isolatedWriter.close();
  }
  console.log("PASS Day 84 noon: same-DB transactional Claim/ACK trust fence, revoke ordering, rollback and missing authority fail-closed");
} finally {
  oldWriter.close(); newWriter.close(); badDigest.close();
  missingDeployment.close(); authority.close(); admin.close();
  rmSync(dir, { recursive: true, force: true });
}
