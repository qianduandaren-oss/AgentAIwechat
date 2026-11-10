import { strict as assert } from "node:assert";
import type { RecoverySingleWriterServicePort } from "../runtime/recovery-single-writer-service-contract.js";
import { RecoveryWriterRpcCandidateHandler } from "../runtime/recovery-writer-rpc-handler.js";
import {
  RecoveryWriterRpcAdmissionHandler,
  type WriterRpcAuditEvent
} from "../runtime/recovery-writer-rpc-admission.js";

let now = 1_000_000;
let allowed = true;
let auditFails = false;
let calls = 0;
const audit: WriterRpcAuditEvent[] = [];
let finish: (() => void) | undefined;
let block = false;
const service: RecoverySingleWriterServicePort = {
  claimOutbox: async () => {
    calls++;
    if (block) await new Promise<void>(resolve => { finish = resolve; });
    return { action: "claimed", eventId: "event:81", leaseToken: "lease-secret" };
  },
  confirmOutbox: async () => {
    calls++;
    return { action: "dispatched", eventId: "event:81" };
  }
};
const deps = {
  nowEpochMs: () => now,
  maxInFlightPerSubject: 1,
  replayTtlMs: 30_000,
  maxReplayKeys: 8,
  reauthorize: async () => allowed,
  recordAudit: (event: WriterRpcAuditEvent) => {
    if (auditFails) throw new Error("audit_unavailable");
    audit.push(event);
  }
};
const handler = new RecoveryWriterRpcAdmissionHandler(new RecoveryWriterRpcCandidateHandler(service), deps);
const caller = {
  subject: "worker:81", mechanism: "verified_peer_identity",
  grantedOperations: ["claim_outbox", "confirm_outbox"]
} as const;
const claim = (id: string) => JSON.stringify({
  requestId: id, operation: "claim_outbox", outboxId: "cmd:81"
});
const reason = async (raw: string, expected: string, control?: {
  signal?: AbortSignal; deadlineEpochMs?: number
}) => {
  const result = await handler.handle(raw, caller, control);
  assert.equal(result.action, "hold");
  if (result.action === "hold") assert.equal(result.reason, expected);
};

await reason(claim("expired"), "admission_cancelled_or_expired", { deadlineEpochMs: now });
const cancelled = new AbortController();
cancelled.abort();
await reason(claim("aborted"), "admission_cancelled_or_expired", { signal: cancelled.signal });
assert.equal(calls, 0);

allowed = false;
await reason(claim("revoked"), "authorization_revoked");
assert.equal(calls, 0);
allowed = true;

auditFails = true;
await reason(claim("audit-failure"), "audit_unavailable");
assert.equal(calls, 0);
auditFails = false;

// Concurrent request IDs from the same subject are bounded BEFORE awaiting the delegate.
block = true;
const first = handler.handle(claim("first"), caller);
for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
assert.ok(finish, "first call should reach the delegate");
await reason(claim("first"), "candidate_request_replay");
await reason(claim("second"), "candidate_concurrency_exceeded");
assert.equal(calls, 1);
// Cancellation after dispatch must not be misrepresented as rollback.
finish!();
block = false;
const accepted = await first;
assert.equal(accepted.action, "claimed");
await reason(claim("first"), "candidate_request_replay");
assert.equal(calls, 1);

const second = await handler.handle(claim("second"), caller);
assert.equal(second.action, "claimed");
assert.equal(calls, 2);

// A confirm operation goes through the same candidate boundary; no raw ACK fields in audit.
const confirm = await handler.handle(JSON.stringify({
  requestId: "confirm", operation: "confirm_outbox",
  outboxId: "cmd:81", eventId: "event:81", leaseToken: "SECRET-TOKEN",
  rawConsumerResponse: { secret: "SECRET-ACK" }
}), caller);
assert.equal(confirm.action, "dispatched");
assert.equal(calls, 3);
assert.ok(audit.every(event =>
  !JSON.stringify(event).includes("SECRET") && Object.keys(event).sort().join(",") ===
    "decision,operation,requestId,subject"
));

// ACL revocation while awaiting policy must block before the service is called.
let releasePolicy: (() => void) | undefined;
const gated = new RecoveryWriterRpcAdmissionHandler(new RecoveryWriterRpcCandidateHandler(service), {
  ...deps,
  reauthorize: async () => {
    await new Promise<void>(resolve => { releasePolicy = resolve; });
    return allowed;
  }
});
allowed = true;
const queued = gated.handle(claim("queued"), caller);
for (let i = 0; i < 10 && !releasePolicy; i++) await Promise.resolve();
assert.ok(releasePolicy);
allowed = false;
releasePolicy!();
const rejected = await queued;
assert.equal(rejected.action, "hold");
if (rejected.action === "hold") assert.equal(rejected.reason, "authorization_revoked");
assert.equal(calls, 3);

// On a new instance, the in-memory replay ledger is lost; eventId/Inbox remains authoritative.
allowed = true;
const newProcess = new RecoveryWriterRpcAdmissionHandler(new RecoveryWriterRpcCandidateHandler(service), deps);
assert.equal((await newProcess.handle(claim("first"), caller)).action, "claimed");
assert.equal(calls, 4);
now += 31_000;
assert.equal((await handler.handle(claim("first"), caller)).action, "claimed");
assert.equal(calls, 5);
console.log("PASS Day 81 candidate RPC admission, replay, concurrency, revocation, audit and timeout boundary");
