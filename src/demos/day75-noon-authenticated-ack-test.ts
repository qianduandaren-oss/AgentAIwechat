import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import { SQLiteRecoveryOutboxDeliveryClaimer } from "../runtime/recovery-outbox-delivery-lease.js";
import { acknowledgeVerifiedConsumerDelivery } from "../runtime/recovery-outbox-authenticated-dispatch.js";
import type { ConsumerAckEvidence } from "../runtime/recovery-outbox-ack-boundary.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const dir = mkdtempSync(join(tmpdir(), "day75-noon-"));
const now = Date.UTC(2026, 10, 4, 4);
let passed = 0;
async function scenario(name: string, run: (ctx: {
  store: SQLiteRecoveryOutboxDeliveryClaimer; record: RecoveryOutboxRecord;
  token: string; evidence: ConsumerAckEvidence;
}) => Promise<void>) {
  const file = join(dir, String(++passed) + ".sqlite");
  const db = new DatabaseSync(file);
  db.exec(RECOVERY_FINALIZATION_SCHEMA);
  const record: RecoveryOutboxRecord = {
    id: "cmd:terminal", eventId: "evt-1", commandId: "cmd", runId: "run",
    kind: "audit", payload: "{}", status: "pending", attempts: 0, version: 1,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
  };
  db.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES (?,?,?,?,?,?)")
    .run(record.id, record.eventId, record.commandId, record.runId, JSON.stringify(record), record.createdAt);
  const store = new SQLiteRecoveryOutboxDeliveryClaimer(file);
  try {
    const claim = store.claim({
      outboxId: record.id, workerId: "worker", nowEpochMs: now,
      leaseMs: 1000, consumer: {
        durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
        deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
      }
    });
    assert.equal(claim.action, "claimed");
    if (claim.action !== "claimed") throw Error("missing claim");
    await run({store, record, token: claim.leaseToken, evidence: {
      eventId: record.eventId, outboxId: record.id, commandId: record.commandId,
      runId: record.runId, consumerId: "consumer-1", evidenceId: "receipt-1",
      observedAtEpochMs: now + 10
    }});
    console.log("PASS " + name);
  } finally { store.close(); db.close(); }
}
const request = (ctx: {record: RecoveryOutboxRecord; token: string}, overrides: Record<string, unknown> = {}) => ({
  outboxId: ctx.record.id, eventId: ctx.record.eventId, leaseToken: ctx.token,
  consumerId: "consumer-1", rawResponse: {authenticated: true},
  nowEpochMs: now + 20, maxEvidenceAgeMs: 30000, ...overrides
});
try {
  await scenario("authenticated evidence and current lease dispatch", async ctx => {
    const result = await acknowledgeVerifiedConsumerDelivery(ctx.store, {
      verify: async () => ctx.evidence
    }, request(ctx));
    assert.equal(result.action, "dispatched");
    assert.equal(ctx.store.inspect(ctx.record.id)?.status, "dispatched");
  });
  await scenario("rejected authentication never dispatches", async ctx => {
    const result = await acknowledgeVerifiedConsumerDelivery(ctx.store, {
      verify: async () => null
    }, request(ctx));
    assert.deepEqual(result, {action: "hold", reason: "consumer_authentication_failed"});
    assert.equal(ctx.store.inspect(ctx.record.id)?.status, "pending");
  });
  await scenario("verifier throws fail closed", async ctx => {
    const result = await acknowledgeVerifiedConsumerDelivery(ctx.store, {
      verify: async () => { throw Error("invalid signature"); }
    }, request(ctx));
    assert.equal(result.action, "hold");
  });
  await scenario("consumer identity mismatch rejected", async ctx => {
    const result = await acknowledgeVerifiedConsumerDelivery(ctx.store, {
      verify: async () => ({...ctx.evidence, consumerId: "attacker"})
    }, request(ctx));
    assert.deepEqual(result, {action:"hold",reason:"identity_mismatch"});
  });
  await scenario("stale evidence rejected", async ctx => {
    const result = await acknowledgeVerifiedConsumerDelivery(ctx.store, {
      verify: async () => ({...ctx.evidence, observedAtEpochMs: now - 50000})
    }, request(ctx));
    assert.equal(result.action, "hold");
  });
  await scenario("wrong lease token rejected after authentication", async ctx => {
    await assert.rejects(
      acknowledgeVerifiedConsumerDelivery(ctx.store, {verify: async () => ctx.evidence},
        request(ctx, {leaseToken: "forged"})),
      /ack_binding_mismatch/
    );
    assert.equal(ctx.store.inspect(ctx.record.id)?.status, "pending");
  });
  await scenario("expired lease rejected after authentication", async ctx => {
    await assert.rejects(
      acknowledgeVerifiedConsumerDelivery(ctx.store, {verify: async () => ctx.evidence},
        request(ctx, {nowEpochMs: now + 1000})),
      /ack_stale_lease/
    );
  });
  console.log("Day 75 noon: 7 authenticated ACK candidate scenarios passed");
} finally { rmSync(dir, {recursive:true, force:true}); }
