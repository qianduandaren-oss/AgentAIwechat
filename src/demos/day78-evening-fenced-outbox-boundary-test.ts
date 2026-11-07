import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { RecoveryDeliveryConflict } from "../runtime/recovery-outbox-delivery-lease.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const dir = mkdtempSync(join(tmpdir(), "day78-evening-"));
const path = join(dir, "outbox.db");
const now = Date.UTC(2026, 10, 7, 10);
const record: RecoveryOutboxRecord = {
  id: "cmd:terminal", eventId: "event:cmd", commandId: "cmd", runId: "run",
  kind: "audit", payload: "{}", status: "pending", attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
};
const contract = { durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true };
const admin = new DatabaseSync(path);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
  .run(record.id, record.eventId, record.commandId, record.runId, JSON.stringify(record), record.createdAt);
const a = new SQLiteFencedOutboxDelivery(path);
const b = new SQLiteFencedOutboxDelivery(path);
const stale = (fn: () => unknown) => assert.throws(fn, (e: unknown) =>
  e instanceof RecoveryDeliveryConflict && e.reason === "stale_writer_fenced");
try {
  const epochA = a.rotate("A");
  const first = a.claim({ outboxId: record.id, workerId: "A", epoch: epochA,
    consumer: contract, nowEpochMs: now, leaseMs: 1000 });
  assert.equal(first.action, "claimed");
  if (first.action !== "claimed") throw new Error("first claim missing");
  const epochB = b.rotate("B");
  stale(() => a.acknowledge({ outboxId: record.id, eventId: record.eventId,
    workerId: "A", epoch: epochA, leaseToken: first.leaseToken, nowEpochMs: now + 1 }));
  stale(() => a.claim({ outboxId: record.id, workerId: "A", epoch: epochA,
    consumer: contract, nowEpochMs: now + 1001, leaseMs: 1000 }));
  assert.equal(b.inspect(record.id)?.status, "pending");
  const second = b.claim({ outboxId: record.id, workerId: "B", epoch: epochB,
    consumer: contract, nowEpochMs: now + 1001, leaseMs: 1000 });
  assert.equal(second.action, "claimed");
  if (second.action !== "claimed") throw new Error("second claim missing");
  assert.throws(() => b.acknowledge({ outboxId: record.id, eventId: record.eventId,
    workerId: "B", epoch: epochB, leaseToken: first.leaseToken, nowEpochMs: now + 1010 }),
    (e: unknown) => e instanceof RecoveryDeliveryConflict && e.reason === "ack_binding_mismatch");
  assert.equal(b.inspect(record.id)?.status, "pending");
  const restarted = new SQLiteFencedOutboxDelivery(path);
  try {
    stale(() => restarted.acknowledge({ outboxId: record.id, eventId: record.eventId,
      workerId: "A", epoch: epochA, leaseToken: first.leaseToken, nowEpochMs: now + 1010 }));
  } finally { restarted.close(); }
  // Deliberately demonstrate the unprotected SQL bypass; this is a release blocker.
  const before = b.inspect(record.id);
  assert.ok(before);
  admin.prepare("UPDATE recovery_outbox SET payload=? WHERE id=?")
    .run(JSON.stringify({ ...before, status: "dispatched", version: before.version + 1 }), record.id);
  assert.equal(b.inspect(record.id)?.status, "dispatched");
  console.log("PASS Day 78 candidate fencing and confirmed direct-SQL bypass (production NO_GO)");
} finally {
  a.close(); b.close(); admin.close(); rmSync(dir, { recursive: true, force: true });
}
