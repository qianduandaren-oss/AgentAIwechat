import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SQLiteRecoveryOutboxDeliveryClaimer, RecoveryDeliveryConflict
} from "../runtime/recovery-outbox-delivery-lease.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import type { RecoveryOutboxConsumerContract } from "../runtime/recovery-outbox-delivery-contract.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";

const root = mkdtempSync(join(tmpdir(), "agent-day74-noon-"));
const now = Date.UTC(2026, 10, 3, 4, 0, 0);
const contract: RecoveryOutboxConsumerContract = {
  durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
};
let count = 0;
function record(): RecoveryOutboxRecord {
  return {
    id: "command-1:remote-receipt-terminal",
    eventId: "recovery:command-1:remote-receipt-terminal",
    commandId: "command-1", runId: "run-1", kind: "audit",
    payload: JSON.stringify({ operation: "quarantine", outcome: "applied" }),
    status: "pending", attempts: 0, version: 1,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
  };
}
function fixture() {
  const path = join(root, "case-" + ++count + ".db");
  const admin = new DatabaseSync(path);
  admin.exec(RECOVERY_FINALIZATION_SCHEMA);
  const initial = record();
  admin.prepare(`
    INSERT INTO recovery_outbox (id,event_id,command_id,run_id,payload,created_at)
    VALUES (?,?,?,?,?,?)
  `).run(initial.id, initial.eventId, initial.commandId,
    initial.runId, JSON.stringify(initial), initial.createdAt);
  const a = new SQLiteRecoveryOutboxDeliveryClaimer(path);
  const b = new SQLiteRecoveryOutboxDeliveryClaimer(path);
  const claim = (store = a, at = now, consumer = contract) =>
    store.claim({ outboxId: initial.id, workerId: store === a ? "A" : "B",
      consumer, nowEpochMs: at, leaseMs: 1000 });
  const ack = (store: SQLiteRecoveryOutboxDeliveryClaimer, token: string, at = now + 10) =>
    store.acknowledge({ outboxId: initial.id, eventId: initial.eventId,
      leaseToken: token, source: "authenticated_consumer_adapter", nowEpochMs: at });
  return { path, admin, a, b, initial, claim, ack,
    close() { a.close(); b.close(); admin.close(); } };
}
function test(name: string, fn: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  try { fn(f); console.log("PASS " + name); }
  finally { f.close(); }
}
function denied(fn: () => unknown, reason: string) {
  assert.throws(fn, (e: unknown) =>
    e instanceof RecoveryDeliveryConflict && e.reason === reason);
}
try {
  test("two connections: only one active lease", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    const second = f.claim(f.b);
    assert.equal(second.action, "busy");
    assert.equal(f.a.inspect(f.initial.id)?.attempts, 1);
  });
  test("eventId stable, attempt/version advance", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    assert.equal(first.consumerIdempotencyKey, f.initial.eventId);
    assert.equal(first.record.eventId, f.initial.eventId);
    assert.equal(first.record.attempts, 1);
    assert.equal(first.record.version, 2);
  });
  test("expired lease reclaimed by another connection", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    const second = f.claim(f.b, now + 1000);
    assert.equal(second.action, "claimed");
    if (second.action !== "claimed") return;
    assert.equal(second.record.attempts, 2);
    assert.equal(second.record.version, 3);
    assert.equal(second.consumerIdempotencyKey, f.initial.eventId);
  });
  test("old worker ACK cannot overwrite new lease", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    const second = f.claim(f.b, now + 1000);
    assert.equal(second.action, "claimed");
    denied(() => f.ack(f.a, first.leaseToken, now + 1001), "ack_binding_mismatch");
    assert.equal(f.a.inspect(f.initial.id)?.status, "pending");
  });
  test("expired lease ACK denied even before re-claim", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    denied(() => f.ack(f.a, first.leaseToken, now + 1000), "ack_stale_lease");
  });
  test("authenticated ACK marks dispatched once", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    assert.equal(f.ack(f.a, first.leaseToken).action, "dispatched");
    assert.equal(f.ack(f.b, first.leaseToken).action, "already_dispatched");
    assert.equal(f.claim(f.b).action, "already_dispatched");
    assert.equal(f.a.inspect(f.initial.id)?.version, 3);
  });
  test("wrong ACK eventId denied", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    denied(() => f.a.acknowledge({ outboxId: f.initial.id, eventId: "other",
      leaseToken: first.leaseToken, source: "authenticated_consumer_adapter",
      nowEpochMs: now + 10 }), "ack_binding_mismatch");
  });
  test("wrong ACK token denied", f => {
    f.claim();
    denied(() => f.ack(f.b, "forged-token"), "ack_binding_mismatch");
  });
  test("untrusted ACK source denied", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    denied(() => f.a.acknowledge({ outboxId: f.initial.id,
      eventId: f.initial.eventId, leaseToken: first.leaseToken,
      source: "client_json" as "authenticated_consumer_adapter",
      nowEpochMs: now + 10 }), "ack_untrusted_or_invalid");
  });
  test("unverified consumer dedupe holds without claim", f => {
    const result = f.claim(f.a, now, { ...contract, durableDedupeByEventId: false });
    assert.deepEqual(result, { action: "hold", reason: "consumer_dedupe_unverified" });
    assert.equal(f.a.inspect(f.initial.id)?.attempts, 0);
  });
  test("short dedupe retention holds", f => {
    assert.equal(f.claim(f.a, now, { ...contract, dedupeRetentionSeconds: 30 }).action, "hold");
  });
  test("missing ACK contract holds", f => {
    assert.equal(f.claim(f.a, now, { ...contract, authenticatedEventAck: false }).action, "hold");
  });
  test("outbox row identity mismatch cannot be claimed", f => {
    const bad = { ...f.initial, eventId: "other" };
    f.admin.prepare("UPDATE recovery_outbox SET payload=? WHERE id=?")
      .run(JSON.stringify(bad), f.initial.id);
    denied(() => f.claim(), "outbox_identity_mismatch");
    const rows = f.admin.prepare("SELECT COUNT(*) AS n FROM recovery_outbox_delivery_leases")
      .get() as { n: number };
    assert.equal(rows.n, 0);
  });
  test("claim and ACK persist across process-like reopen", f => {
    const first = f.claim();
    assert.equal(first.action, "claimed");
    if (first.action !== "claimed") return;
    const reopened = new SQLiteRecoveryOutboxDeliveryClaimer(f.path);
    try {
      assert.equal(reopened.claim({ outboxId: f.initial.id, workerId: "C",
        consumer: contract, nowEpochMs: now + 1, leaseMs: 1000 }).action, "busy");
      assert.equal(reopened.acknowledge({ outboxId: f.initial.id,
        eventId: f.initial.eventId, leaseToken: first.leaseToken,
        source: "authenticated_consumer_adapter", nowEpochMs: now + 10 }).action, "dispatched");
    } finally { reopened.close(); }
  });
  test("missing event holds without mutation", f => {
    assert.deepEqual(f.a.claim({ outboxId: "missing", workerId: "A",
      consumer: contract, nowEpochMs: now, leaseMs: 1000 }),
      { action: "hold", reason: "outbox_missing" });
  });
  test("invalid lease duration holds", f => {
    assert.equal(f.a.claim({ outboxId: f.initial.id, workerId: "A",
      consumer: contract, nowEpochMs: now, leaseMs: 0 }).action, "hold");
  });
  console.log("Day 74 noon: 16 SQLite delivery lease scenarios passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
