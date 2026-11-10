import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConsumerAckEvidence } from "../runtime/recovery-outbox-ack-boundary.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import type { TrustedDispatcherCutoverEvidence } from "../runtime/recovery-dispatcher-cutover-policy.js";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { RecoveryWriterRpcCandidateHandler } from "../runtime/recovery-writer-rpc-handler.js";
import { bootstrapSingleWriterCandidate } from "../runtime/recovery-single-writer-candidate-service.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";

const dir = mkdtempSync(join(tmpdir(), "day81-noon-rpc-"));
const path = join(dir, "candidate.sqlite");
const now = Date.UTC(2026, 10, 10, 4);
const record: RecoveryOutboxRecord = {
  id: "cmd:day81", eventId: "event:day81", commandId: "cmd", runId: "run",
  kind: "audit", payload: "{}", status: "pending", attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
};
const admin = new DatabaseSync(path);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
  .run(record.id, record.eventId, record.commandId, record.runId, JSON.stringify(record), record.createdAt);
const store = new SQLiteFencedOutboxDelivery(path);
const epoch = store.rotate("trusted-writer");
const cutover: TrustedDispatcherCutoverEvidence = {
  legacyDispatcherDisabled: true, rawAcknowledgeRestricted: true,
  verifiedAdapterConfigured: true, durableConsumerDedupeVerified: true,
  exclusiveSqliteWriter: true, noMixedVersionWorkers: true
};
let adapterCalls = 0;
let ackValid = false;
const ackEvidence: ConsumerAckEvidence = {
  eventId: record.eventId, outboxId: record.id, commandId: record.commandId,
  runId: record.runId, consumerId: "consumer-1",
  evidenceId: "receipt-81", observedAtEpochMs: now
};
const caller = {
  subject: "svc:worker-81", mechanism: "verified_peer_identity",
  grantedOperations: ["claim_outbox", "confirm_outbox"]
} as const;
const claimOnly = {
  subject: "svc:claim-only", mechanism: "mutual_tls",
  grantedOperations: ["claim_outbox"]
} as const;
const payload = (request: object) => JSON.stringify(request);
const claimRequest = { requestId: "req-81-claim", operation: "claim_outbox", outboxId: record.id };
try {
  const boot = await bootstrapSingleWriterCandidate({
    store,
    cutoverEvidence: { collect: async () => cutover },
    writerIdentity: { snapshot: async () => ({ownerId: "trusted-writer", epoch}) },
    verifiedAckAdapter: { verify: async (_raw: unknown): Promise<ConsumerAckEvidence | null> => {
      adapterCalls++;
      return ackValid ? ackEvidence : null;
    } },
    consumer: {
      durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
      deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
    },
    consumerId: "consumer-1", clock: () => now,
    leaseMs: 30_000, maxEvidenceAgeMs: 30_000
  });
  assert.equal(boot.action, "ready_for_candidate_tests");
  if (boot.action !== "ready_for_candidate_tests") throw Error("candidate did not start");
  const handler = new RecoveryWriterRpcCandidateHandler(boot.service);
  const before = () => store.inspect(record.id)?.status;
  const rejected = async (raw: unknown, identity: typeof caller | typeof claimOnly | null, reason: string) => {
    const result = await handler.handle(raw, identity);
    assert.equal(result.action, "hold");
    if (result.action === "hold") assert.equal(result.reason, reason);
    assert.equal(before(), "pending");
  };

  await rejected(payload(claimRequest), null, "transport_identity_or_permission_denied");
  await rejected(payload({...claimRequest, ownerId: "trusted-writer"}), caller, "unexpected_or_missing_field");
  await rejected(payload({...claimRequest, epoch: 123}), caller, "unexpected_or_missing_field");
  await rejected(payload({...claimRequest, caller: {subject: "admin"}}), null, "unexpected_or_missing_field");
  await rejected(payload({...claimRequest, operation: "rotate_epoch"}), caller, "unsupported_operation");
  await rejected(payload({...claimRequest, dbPath: "/tmp/agent.db"}), caller, "unexpected_or_missing_field");
  await rejected("{", caller, "invalid_json");
  await rejected({...claimRequest}, caller, "invalid_request_encoding");
  await rejected(" ".repeat(17_000), caller, "request_too_large");
  await rejected(payload({...claimRequest, requestId: "bad id!"}), caller, "invalid_request_id");
  await rejected(payload({...claimRequest, outboxId: ""}), caller, "invalid_outbox_id");

  const claim = await handler.handle(payload(claimRequest), claimOnly);
  assert.equal(claim.action, "claimed");
  if (claim.action !== "claimed") throw Error("claim failed");
  const confirmation = {
    requestId: "req-81-ack", operation: "confirm_outbox", outboxId: record.id,
    eventId: record.eventId, leaseToken: claim.leaseToken,
    rawConsumerResponse: { receipt: "candidate-only" }
  };
  const permissionDenied = await handler.handle(payload(confirmation), claimOnly);
  assert.equal(permissionDenied.action, "hold");
  if (permissionDenied.action === "hold") {
    assert.equal(permissionDenied.reason, "transport_identity_or_permission_denied");
  }
  assert.equal(adapterCalls, 0); // Authorization rejects before hitting ACK verifier.
  assert.equal(before(), "pending");
  const fakeAck = await handler.handle(payload(confirmation), caller);
  assert.equal(fakeAck.action, "hold"); // Server-side verifier refuses the raw ACK.
  assert.equal(adapterCalls, 1);
  assert.equal(before(), "pending");
  const forgedEpoch = await handler.handle(payload({...confirmation, epoch}), caller);
  assert.equal(forgedEpoch.action, "hold"); // forbidden top-level wire field
  assert.equal(before(), "pending");

  ackValid = true;
  const validAck = await handler.handle(payload(confirmation), caller);
  assert.deepEqual(validAck, {
    requestId: "req-81-ack", action: "dispatched", eventId: record.eventId
  });
  assert.equal(store.inspect(record.id)?.status, "dispatched");
  console.log("PASS Day 81 strict JSON, runtime allowlist, authorization, verified ACK and fenced SQLite candidate");
} finally {
  store.close(); admin.close(); rmSync(dir, { recursive: true, force: true });
}
