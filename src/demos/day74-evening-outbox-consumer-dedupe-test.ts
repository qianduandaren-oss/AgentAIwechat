import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import {
  SQLiteRecoveryOutboxDeliveryClaimer, RecoveryDeliveryConflict
} from "../runtime/recovery-outbox-delivery-lease.js";
import {
  SQLiteRecoveryOutboxConsumerInbox, RecoveryConsumerInboxConflict
} from "../runtime/recovery-outbox-consumer-inbox.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import type { RecoveryOutboxConsumerContract } from "../runtime/recovery-outbox-delivery-contract.js";

const root = mkdtempSync(join(tmpdir(), "agent-day74-evening-"));
const now = Date.UTC(2026, 10, 3, 10, 0, 0);
const consumerContract: RecoveryOutboxConsumerContract = {
  durableDedupeByEventId: true,
  dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600,
  authenticatedEventAck: true
};
let serial = 0;
let checks = 0;
function seed(): RecoveryOutboxRecord {
  return {
    id: "command-1:remote-receipt-terminal",
    eventId: "recovery:command-1:remote-receipt-terminal",
    commandId: "command-1", runId: "run-1", kind: "audit",
    payload: JSON.stringify({ operation: "quarantine", outcome: "applied",
      providerId: "provider-a", receiptId: "receipt-123" }),
    status: "pending", attempts: 0, version: 1,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
  };
}
function fixture() {
  const producerFile = join(root, "producer-" + ++serial + ".db");
  const consumerFile = join(root, "consumer-" + serial + ".db");
  const admin = new DatabaseSync(producerFile);
  admin.exec(RECOVERY_FINALIZATION_SCHEMA);
  const initial = seed();
  admin.prepare(\`
    INSERT INTO recovery_outbox (id,event_id,command_id,run_id,payload,created_at)
    VALUES (?,?,?,?,?,?)
  \`).run(initial.id, initial.eventId, initial.commandId,
    initial.runId, JSON.stringify(initial), initial.createdAt);
  const a = new SQLiteRecoveryOutboxDeliveryClaimer(producerFile);
  const b = new SQLiteRecoveryOutboxDeliveryClaimer(producerFile);
  const consumerA = new SQLiteRecoveryOutboxConsumerInbox(consumerFile);
  const consumerB = new SQLiteRecoveryOutboxConsumerInbox(consumerFile);
  const claim = (worker: SQLiteRecoveryOutboxDeliveryClaimer, at: number) =>
    worker.claim({ outboxId: initial.id, workerId: worker === a ? "A" : "B",
      consumer: consumerContract, nowEpochMs: at, leaseMs: 1000 });
  return { producerFile, consumerFile, admin, a, b, consumerA, consumerB,
    initial, claim, close() { consumerB.close(); consumerA.close(); b.close(); a.close(); admin.close(); } };
}
function test(name: string, fn: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  try { fn(f); checks++; console.log("PASS " + name); }
  finally { f.close(); }
}
function consumerDenied(fn: () => unknown, reason: string) {
  assert.throws(fn, (error: unknown) =>
    error instanceof RecoveryConsumerInboxConflict && error.reason === reason);
}
function deliveryDenied(fn: () => unknown, reason: string) {
  assert.throws(fn, (error: unknown) =>
    error instanceof RecoveryDeliveryConflict && error.reason === reason);
}
try {
  test("consumer effect and inbox are committed once", f => {
    const c = f.claim(f.a, now);
    assert.equal(c.action, "claimed");
    if (c.action !== "claimed") return;
    assert.equal(f.consumerA.consume(c.record, { nowEpochMs: now + 10 }).action, "applied");
    assert.equal(f.consumerA.countApplied(), 1);
    assert.equal(f.consumerA.inspect(c.record.eventId).inbox?.command_id, c.record.commandId);
  });
  test("lost ACK, expired lease, new worker: same eventId is replayed", f => {
    const first = f.claim(f.a, now);
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    const applied = f.consumerA.consume(first.record, { nowEpochMs: now + 10 });
    assert.equal(applied.action, "applied");
    assert.equal(f.claim(f.b, now + 500).action, "busy");
    const second = f.claim(f.b, now + 1000);
    assert.equal(second.action, "claimed");
    if (second.action !== "claimed") return;
    assert.equal(second.record.eventId, first.record.eventId);
    const replay = f.consumerB.consume(second.record, { nowEpochMs: now + 1001 });
    assert.equal(replay.action, "replayed");
    assert.deepEqual(replay.consumerEvidence, applied.consumerEvidence);
    assert.equal(f.consumerB.countApplied(), 1);
    deliveryDenied(() => f.a.acknowledge({
      outboxId: first.record.id, eventId: first.record.eventId,
      leaseToken: first.leaseToken, source: "authenticated_consumer_adapter",
      nowEpochMs: now + 1002
    }), "ack_binding_mismatch");
    // Simulated trusted adapter only: source string is NOT actual authentication.
    assert.equal(f.b.acknowledge({
      outboxId: second.record.id, eventId: second.record.eventId,
      leaseToken: second.leaseToken, source: "authenticated_consumer_adapter",
      nowEpochMs: now + 1002
    }).action, "dispatched");
    assert.equal(f.b.inspect(first.record.id)?.status, "dispatched");
  });
  test("two consumer SQLite connections share durable eventId dedupe", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    assert.equal(f.consumerA.consume(c.record, { nowEpochMs: now + 1 }).action, "applied");
    assert.equal(f.consumerB.consume(c.record, { nowEpochMs: now + 2 }).action, "replayed");
    assert.equal(f.consumerA.countApplied(), 1);
  });
  test("crash after inbox insert rolls back both rows", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    consumerDenied(() => f.consumerA.consume(c.record, {
      nowEpochMs: now + 1, faultAt: "after_inbox_insert"
    }), "injected_after_inbox_insert");
    assert.equal(f.consumerA.inspect(c.record.eventId).inbox, undefined);
    assert.equal(f.consumerA.countApplied(), 0);
    assert.equal(f.consumerB.consume(c.record, { nowEpochMs: now + 2 }).action, "applied");
  });
  test("crash after business insert rolls back both rows", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    consumerDenied(() => f.consumerA.consume(c.record, {
      nowEpochMs: now + 1, faultAt: "after_effect_insert"
    }), "injected_after_effect_insert");
    assert.equal(f.consumerA.inspect(c.record.eventId).inbox, undefined);
    assert.equal(f.consumerA.countApplied(), 0);
  });
  test("same eventId with altered payload cannot claim new business effect", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    f.consumerA.consume(c.record, { nowEpochMs: now + 1 });
    consumerDenied(() => f.consumerB.consume({ ...c.record,
      payload: JSON.stringify({ operation: "delete_everything" })
    }, { nowEpochMs: now + 2 }), "event_id_rebound");
    assert.equal(f.consumerB.countApplied(), 1);
  });
  test("same eventId with another commandId is rejected", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    f.consumerA.consume(c.record, { nowEpochMs: now + 1 });
    consumerDenied(() => f.consumerB.consume({ ...c.record,
      commandId: "other-command"
    }, { nowEpochMs: now + 2 }), "event_id_rebound");
  });
  test("consumer evidence survives reopening separate consumer database", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    const applied = f.consumerA.consume(c.record, { nowEpochMs: now + 1 });
    const restarted = new SQLiteRecoveryOutboxConsumerInbox(f.consumerFile);
    try {
      const replay = restarted.consume(c.record, { nowEpochMs: now + 500 });
      assert.equal(replay.action, "replayed");
      assert.deepEqual(replay.consumerEvidence, applied.consumerEvidence);
      assert.equal(restarted.countApplied(), 1);
    } finally { restarted.close(); }
  });
  test("invalid envelope is rejected without consumer mutation", f => {
    consumerDenied(() => f.consumerA.consume({ ...f.initial,
      eventId: ""
    }, { nowEpochMs: now }), "invalid_event_envelope");
    assert.equal(f.consumerA.countApplied(), 0);
  });
  test("inbox/effect divergence blocks replay rather than faking ACK", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    f.consumerA.consume(c.record, { nowEpochMs: now + 1 });
    const consumerAdmin = new DatabaseSync(f.consumerFile);
    try {
      consumerAdmin.prepare("DELETE FROM recovery_consumer_business_effects WHERE event_id=?")
        .run(c.record.eventId);
    } finally { consumerAdmin.close(); }
    consumerDenied(() => f.consumerB.consume(c.record, { nowEpochMs: now + 2 }),
      "consumer_effect_inconsistent");
  });
  test("consumer retry accepts new attempt/version but preserves original evidence", f => {
    const first = f.claim(f.a, now);
    if (first.action !== "claimed") throw new Error("claim failed");
    const applied = f.consumerA.consume(first.record, { nowEpochMs: now + 1 });
    const second = f.claim(f.b, now + 1000);
    if (second.action !== "claimed") throw new Error("reclaim failed");
    assert.equal(second.record.attempts, 2);
    assert.equal(second.record.version, 3);
    const replay = f.consumerB.consume(second.record, { nowEpochMs: now + 1001 });
    assert.equal(replay.action, "replayed");
    assert.equal(replay.consumerEvidence.consumedAtEpochMs,
      applied.consumerEvidence.consumedAtEpochMs);
  });
  test("dispatched record can still be deduped if network delivers it late", f => {
    const c = f.claim(f.a, now);
    if (c.action !== "claimed") throw new Error("claim failed");
    f.consumerA.consume(c.record, { nowEpochMs: now + 1 });
    f.a.acknowledge({ outboxId: c.record.id, eventId: c.record.eventId,
      leaseToken: c.leaseToken, source: "authenticated_consumer_adapter",
      nowEpochMs: now + 2 });
    const late = f.a.inspect(c.record.id);
    if (!late) throw new Error("outbox missing");
    assert.equal(f.consumerB.consume(late, { nowEpochMs: now + 3 }).action, "replayed");
    assert.equal(f.consumerB.countApplied(), 1);
  });
  console.log("Day 74 evening: " + checks + " SQLite consumer/producer boundary scenarios passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
