import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryAuthorizationEvidence } from "../runtime/recovery-authorization-evidence.js";
import {
  RecoveryEffectLedgerConflictError,
  SQLiteRecoveryExternalEffectLedger
} from "../runtime/recovery-external-effect-ledger.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryExternalEffectIntent, RecoveryExternalEffectFence } from
  "../runtime/recovery-external-effect-fence.js";
import type { RecoveryRemoteAppliedReceipt, RecoveryRemoteReceiptReviewInput } from
  "../runtime/recovery-remote-receipt-review.js";
import type { RecoveryProviderConformanceRegistry, RecoveryProviderProbeEvidence } from
  "../runtime/recovery-provider-conformance-gate.js";
import type { RecoveryProviderCapabilityProfile } from
  "../runtime/recovery-provider-capability-contract.js";

const now = Date.UTC(2026, 10, 1, 4, 0);
const profile: RecoveryProviderCapabilityProfile = {
  providerId: "provider-a", source: "verified_server_adapter",
  capabilities: { atomicIdempotency: true, epochFencing: true, statusQuery: "authoritative_final" },
  stableReceiptIdentity: true, finalNegativeNoLateCommit: true,
  idempotencyScope: "effect", idempotencyRetentionSeconds: 7200
};
const probe: RecoveryProviderProbeEvidence = {
  providerId: "provider-a", source: "trusted_server_test_harness",
  profileRevision: 1, testedAtEpochMs: now - 500, result: "passed",
  observed: {
    sameKeyDeduplicatedAtSink: true, staleEpochRejectedAtSink: true,
    authoritativeFinalQuery: true, receiptBoundToEffect: true,
    noLateCommitAfterFinalNegative: true, effectScopedKey: true,
    retentionCoversRecoveryWindow: true
  }
};
let revision = 1;
let unresolved = false;
let authorityDown = false;
const registry: RecoveryProviderConformanceRegistry = {
  getVerifiedProfile: id => {
    if (authorityDown) throw Error("authority down");
    return id === "provider-a" ? profile : undefined;
  },
  getCurrentProfileRevision: () => revision,
  getLatestProbe: id => id === "provider-a" ? probe : undefined,
  getUnresolvedViolations: () => unresolved ? ["duplicate_effect"] : []
};

let counter = 0;
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error("Day 72 noon: " + message);
}
function expectConflict(run: () => unknown, message: string): void {
  let conflict = false;
  try { run(); }
  catch (error) { conflict = error instanceof RecoveryEffectLedgerConflictError; }
  check(conflict, message);
}
async function fixture() {
  await mkdir("tmp", { recursive: true });
  const index = ++counter;
  const file = "tmp/day72-noon-" + Date.now() + "-" + index + ".db";
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file);
  const admin = new DatabaseSync(file);
  admin.exec("PRAGMA busy_timeout = 5000;");
  const command: DurableRecoveryOperationCommand = {
    commandId: "command-day72-noon-" + index,
    runId: "run-day72-noon-" + index,
    operation: "quarantine", requestedBy: "operator-a",
    reason: "remote receipt after ACK loss",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const evidence: RecoveryAuthorizationEvidence = {
    actorId: "operator-a", tenantId: "tenant-a",
    runId: command.runId, operation: "quarantine", allowed: true,
    revisions: { runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9 }
  };
  admin.prepare(
    "INSERT INTO recovery_authority_runs (run_id,tenant_id,tenant_revision,acl_revision) VALUES (?,'tenant-a',3,5)"
  ).run(command.runId);
  admin.prepare(
    "INSERT INTO recovery_authority_actor_grants (actor_id,tenant_id,operation,grant_revision,allowed) VALUES ('operator-a','tenant-a','quarantine',9,1)"
  ).run();
  admin.prepare(
    "INSERT INTO recovery_authority_run_permissions (run_id,actor_id,operation,allowed) VALUES (?,'operator-a','quarantine',1)"
  ).run(command.runId);
  const claimed = await finalizer.claimAuthorized(command, "atomic_control_only", evidence);
  check(claimed.action === "claimed_executing", "must claim authorized executing command");
  const intent: RecoveryExternalEffectIntent = {
    command, owner: "atomic_control_only",
    effectId: "notify:" + command.commandId,
    idempotencyKey: command.commandId + ":notify",
    authorizationEvidence: evidence
  };
  const a = new SQLiteRecoveryExternalEffectLedger(file);
  const b = new SQLiteRecoveryExternalEffectLedger(file);
  a.stageIntent(intent);
  const got = a.claimDispatch(intent.effectId, "worker-a");
  check(got.action === "claimed", "must claim effect epoch");
  const fence = got.fence;
  a.markUnknown(intent.effectId, fence.epoch);
  const receipt: RecoveryRemoteAppliedReceipt = {
    source: "authenticated_server_adapter",
    providerId: "provider-a", profileRevision: 1,
    receiptId: "remote-receipt-" + index,
    commandId: command.commandId, runId: command.runId,
    operation: command.operation, actorId: "operator-a",
    tenantId: "tenant-a", owner: "atomic_control_only",
    effectId: intent.effectId, idempotencyKey: intent.idempotencyKey,
    epoch: fence.epoch, observedAtEpochMs: now - 10
  };
  const input: Omit<RecoveryRemoteReceiptReviewInput, "ledger"> = {
    intent, fence, receipt, providerId: "provider-a",
    recoveryWindowSeconds: 3600, nowEpochMs: now,
    maxProbeAgeMs: 60000, maxObservationAgeMs: 30000
  };
  return {
    file, a, b, admin, finalizer, intent, fence, receipt, input,
    close() { b.close(); a.close(); admin.close(); finalizer.close(); }
  };
}

// 1. Applied receipt creates only evidence, never a Command terminal.
{
  const x = await fixture();
  try {
    check(x.a.persistReviewedRemoteAppliedReceipt(registry, x.input) === "stored", "first trusted receipt");
    check(x.a.countRemoteReceipts() === 1, "one evidence row");
    check(x.a.inspect(x.intent.effectId)?.status === "unknown", "effect stays UNKNOWN");
    const row = x.admin.prepare(
      "SELECT version,payload FROM recovery_commands WHERE command_id=?"
    ).get(x.intent.command.commandId) as { version: number; payload: string };
    check(row.version === 2 && JSON.parse(row.payload).status === "executing",
      "Command remains executing v2");
    check(x.a.countSimulatedEffects() === 0, "no simulated sink side effect");
    checks++;
  } finally { x.close(); }
}

// 2. Two real SQLite connections racing for same receipt yield one durable row.
{
  const x = await fixture();
  try {
    const [one, two] = await Promise.all([
      Promise.resolve().then(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input)),
      Promise.resolve().then(() => x.b.persistReviewedRemoteAppliedReceipt(registry, x.input))
    ]);
    check([one,two].includes("stored") && [one,two].includes("already_stored"),
      "exactly one insert; second is idempotent");
    check(x.a.countRemoteReceipts() === 1, "no duplicate rows");
    checks++;
  } finally { x.close(); }
}

// 3. One receiptId must not be reused for a different authorized Effect.
{
  const x = await fixture();
  try {
    x.a.persistReviewedRemoteAppliedReceipt(registry, x.input);
    const other: RecoveryExternalEffectIntent = {
      ...x.intent, effectId: "second:" + x.intent.command.commandId,
      idempotencyKey: "second-key:" + x.intent.command.commandId
    };
    x.b.stageIntent(other);
    const got = x.b.claimDispatch(other.effectId, "worker-b");
    check(got.action === "claimed", "second effect has distinct lease");
    x.b.markUnknown(other.effectId, got.fence.epoch);
    const rebind = {
      ...x.input, intent: other, fence: got.fence,
      receipt: {
        ...x.receipt, effectId: other.effectId,
        idempotencyKey: other.idempotencyKey, epoch: got.fence.epoch
      }
    };
    expectConflict(() => x.b.persistReviewedRemoteAppliedReceipt(registry, rebind),
      "cross-effect receipt reuse rejected");
    check(x.a.countRemoteReceipts() === 1, "original receipt preserved");
    checks++;
  } finally { x.close(); }
}

// 4. One Effect cannot be assigned a different receiptId.
{
  const x = await fixture();
  try {
    x.a.persistReviewedRemoteAppliedReceipt(registry, x.input);
    expectConflict(() => x.b.persistReviewedRemoteAppliedReceipt(registry, {
      ...x.input, receipt: { ...x.receipt, receiptId: "another-id" }
    }), "different receiptId cannot overwrite effect");
    checks++;
  } finally { x.close(); }
}

// 5. Re-query later may update observation timestamp, but not persisted original.
{
  const x = await fixture();
  try {
    x.a.persistReviewedRemoteAppliedReceipt(registry, x.input);
    const next = x.receipt.observedAtEpochMs + 5;
    check(x.b.persistReviewedRemoteAppliedReceipt(registry, {
      ...x.input, receipt: { ...x.receipt, observedAtEpochMs: next }
    }) === "already_stored", "same receipt new observation remains idempotent");
    check(x.a.inspectRemoteReceipt(x.intent.effectId)?.observedAtEpochMs ===
      x.receipt.observedAtEpochMs, "original trusted observation immutable");
    checks++;
  } finally { x.close(); }
}

// 6. Stale or mismatched Epoch fails closed, with no receipt.
{
  const x = await fixture();
  try {
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, {
      ...x.input, fence: { ...x.fence, epoch: 2 }
    }), "forged future epoch");
    check(x.a.countRemoteReceipts() === 0, "no write");
    checks++;
  } finally { x.close(); }
}

// 7. Pending is not UNKNOWN; do not synthesize applied evidence.
{
  const x = await fixture();
  try {
    x.admin.prepare(
      "UPDATE recovery_effect_intents SET status='pending' WHERE effect_id=?"
    ).run(x.intent.effectId);
    expectConflict(() => x.b.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "wrong ledger state");
    checks++;
  } finally { x.close(); }
}

// 8. Administrator revokes actor grant after provider observation.
{
  const x = await fixture();
  try {
    x.admin.prepare(
      "UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10 WHERE actor_id='operator-a'"
    ).run();
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "revoke before receipt commit denied");
    check(x.a.countRemoteReceipts() === 0 &&
      x.a.inspect(x.intent.effectId)?.status === "unknown", "no partial write");
    checks++;
  } finally { x.close(); }
}

// 9. Resource ACL drift prevents stale evidence persistence.
{
  const x = await fixture();
  try {
    x.admin.prepare(
      "UPDATE recovery_authority_runs SET acl_revision=6 WHERE run_id=?"
    ).run(x.intent.command.runId);
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "Run ACL revision drift");
    checks++;
  } finally { x.close(); }
}

// 10. Provider profile revision drift invalidates observation.
{
  const x = await fixture();
  try {
    revision = 2;
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "provider profile changed");
    check(x.a.countRemoteReceipts() === 0, "no receipt on revision drift");
    checks++;
  } finally { revision = 1; x.close(); }
}

// 11. Open provider violation quarantines receipt candidate.
{
  const x = await fixture();
  try {
    unresolved = true;
    expectConflict(() => x.b.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "provider incident open");
    checks++;
  } finally { unresolved = false; x.close(); }
}

// 12. Forged provider marker / identity fails before write.
{
  const x = await fixture();
  try {
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, {
      ...x.input,
      receipt: { ...x.receipt, source: "client_claim" as RecoveryRemoteAppliedReceipt["source"] }
    }), "untrusted receipt");
    checks++;
  } finally { x.close(); }
}

// 13. Registry unavailable is denial, not fallback to local-sink assumption.
{
  const x = await fixture();
  try {
    authorityDown = true;
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "registry outage must fail closed");
    checks++;
  } finally { authorityDown = false; x.close(); }
}

// 14. Restart preserves immutable receipt without inventing Effect success.
{
  const x = await fixture();
  try {
    x.a.persistReviewedRemoteAppliedReceipt(registry, x.input);
    const restarted = new SQLiteRecoveryExternalEffectLedger(x.file);
    try {
      check(restarted.countRemoteReceipts() === 1 &&
        restarted.inspectRemoteReceipt(x.intent.effectId)?.receiptId === x.receipt.receiptId,
        "receipt persists after restart");
      check(restarted.inspect(x.intent.effectId)?.status === "unknown",
        "UNKNOWN persists after restart");
      checks++;
    } finally { restarted.close(); }
  } finally { x.close(); }
}

// 15. Once remote receipt is stored, local mock's negative is not proof of failure.
{
  const x = await fixture();
  try {
    x.a.persistReviewedRemoteAppliedReceipt(registry, x.input);
    expectConflict(
      () => x.b.reconcileAgainstSameSQLiteSink(x.intent.effectId),
      "local sink absence cannot erase remote-applied evidence"
    );
    check(x.a.inspect(x.intent.effectId)?.status === "unknown", "no pending reset");
    checks++;
  } finally { x.close(); }
}

// 16. Command deletion blocks evidence storage even for valid receipt.
{
  const x = await fixture();
  try {
    x.admin.prepare("DELETE FROM recovery_commands WHERE command_id=?")
      .run(x.intent.command.commandId);
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "missing durable Command");
    checks++;
  } finally { x.close(); }
}

// 17. Contradictory local simulated sink receipt must not mix proof domains.
{
  const x = await fixture();
  try {
    x.admin.prepare(
      "INSERT INTO recovery_effect_sink_receipts (idempotency_key,effect_id,applied_epoch) VALUES (?,?,1)"
    ).run(x.intent.idempotencyKey, x.intent.effectId);
    expectConflict(() => x.a.persistReviewedRemoteAppliedReceipt(registry, x.input),
      "mixed local and remote proof prohibited");
    checks++;
  } finally { x.close(); }
}

check(checks === 17, "all 17 real SQLite scenarios");
console.log("Day 72 noon: 17/17 remote receipt persistence scenarios passed.");
console.log("Remote receipt persists; Effect UNKNOWN and Command executing v2 remain; NO_GO.");
