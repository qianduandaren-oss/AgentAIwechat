import { strict as assert } from "node:assert";
import { planRecoveryOutboxDelivery, type RecoveryOutboxConsumerContract } from "../runtime/recovery-outbox-delivery-contract.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const record: RecoveryOutboxRecord = {
  id: "command-1:remote-receipt-terminal",
  eventId: "recovery:command-1:remote-receipt-terminal",
  commandId: "command-1", runId: "run-1",
  kind: "audit", payload: '{"outcome":"applied"}',
  status: "pending", attempts: 0, version: 1,
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z"
};
const consumer: RecoveryOutboxConsumerContract = {
  durableDedupeByEventId: true,
  dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600,
  authenticatedEventAck: true
};
let checks = 0;
function expectAction(
  r: RecoveryOutboxRecord, c: RecoveryOutboxConsumerContract, action: string,
  reason?: string
): void {
  const result = planRecoveryOutboxDelivery(r, c);
  assert.equal(result.action, action);
  if (reason) assert.equal(result.action === "hold" ? result.reason : "", reason);
  checks++;
}

const before = JSON.stringify(record);
const ready = planRecoveryOutboxDelivery(record, consumer);
assert.equal(ready.action, "requires_atomic_delivery_claim"); checks++;
if (ready.action === "requires_atomic_delivery_claim") {
  assert.equal(ready.consumerIdempotencyKey, record.eventId); checks++;
  assert.equal(ready.expectedVersion, 1); checks++;
  assert.equal(ready.publishAuthorized, false); checks++;
}
assert.equal(JSON.stringify(record), before); checks++;
expectAction({ ...record, status: "dispatched" }, consumer, "already_dispatched");
expectAction(record, { ...consumer, durableDedupeByEventId: false }, "hold", "consumer_dedupe_unverified");
expectAction(record, { ...consumer, dedupeRetentionSeconds: 30 }, "hold", "dedupe_window_insufficient");
expectAction(record, { ...consumer, authenticatedEventAck: false }, "hold", "ack_contract_unverified");
expectAction({ ...record, eventId: "" }, consumer, "hold", "invalid_outbox_record");
expectAction({ ...record, version: 0 }, consumer, "hold", "invalid_outbox_record");
expectAction({ ...record, attempts: -1 }, consumer, "hold", "invalid_outbox_record");
expectAction({ ...record, payload: "" }, consumer, "hold", "invalid_outbox_record");
expectAction(record, { ...consumer, deliveryRecoveryWindowSeconds: 0 }, "hold", "dedupe_window_insufficient");
console.log("Day 74 morning outbox delivery contract:", checks, "checks passed");
