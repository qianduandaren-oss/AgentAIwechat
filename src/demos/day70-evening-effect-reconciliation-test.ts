import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryAuthorizationEvidence } from "../runtime/recovery-authorization-evidence.js";
import type {
  RecoveryExternalEffectIntent,
  RecoveryExternalEffectFence
} from "../runtime/recovery-external-effect-fence.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";
import { SQLiteRecoveryExternalEffectLedger } from "../runtime/recovery-external-effect-ledger.js";
import {
  planUnknownRemoteEffectRecovery,
  type RecoveryRemoteProviderCapabilities,
  type RecoveryRemoteProviderObservation
} from "../runtime/recovery-external-effect-reconciliation.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Day 70 evening: " + message);
}

let serial = 0;
async function setup() {
  await mkdir("tmp", { recursive: true });
  const n = ++serial;
  const file = "tmp/day70-evening-" + Date.now() + "-" + n + ".db";
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file);
  const admin = new DatabaseSync(file);
  admin.exec("PRAGMA busy_timeout = 5000;");
  const runId = "run-day70-evening-" + n;
  const command: DurableRecoveryOperationCommand = {
    commandId: "command-day70-evening-" + n,
    runId, operation: "quarantine",
    requestedBy: "operator-a", reason: "remote provider ACK may be lost",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const evidence: RecoveryAuthorizationEvidence = {
    actorId: "operator-a", tenantId: "tenant-a",
    runId, operation: "quarantine", allowed: true,
    revisions: {
      runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9
    }
  };
  admin.prepare(
    "INSERT INTO recovery_authority_runs (run_id,tenant_id,tenant_revision,acl_revision) VALUES (?,'tenant-a',3,5)"
  ).run(runId);
  admin.prepare(
    "INSERT INTO recovery_authority_actor_grants (actor_id,tenant_id,operation,grant_revision,allowed) VALUES ('operator-a','tenant-a','quarantine',9,1)"
  ).run();
  admin.prepare(
    "INSERT INTO recovery_authority_run_permissions (run_id,actor_id,operation,allowed) VALUES (?,'operator-a','quarantine',1)"
  ).run(runId);
  const claim = await finalizer.claimAuthorized(command, "atomic_control_only", evidence);
  check(claim.action === "claimed_executing", "authorized executing command required");
  const intent: RecoveryExternalEffectIntent = {
    command, owner: "atomic_control_only",
    effectId: "notify:" + command.commandId,
    idempotencyKey: command.commandId + ":notify",
    authorizationEvidence: evidence
  };
  const ledgerA = new SQLiteRecoveryExternalEffectLedger(file);
  const ledgerB = new SQLiteRecoveryExternalEffectLedger(file);
  ledgerA.stageIntent(intent);
  const leased = ledgerA.claimDispatch(intent.effectId, "worker-a");
  check(leased.action === "claimed", "effect epoch must be leased");
  return {
    file, intent, fence: leased.fence, admin, ledgerA, ledgerB, finalizer,
    close() { ledgerB.close(); ledgerA.close(); admin.close(); finalizer.close(); }
  };
}

const caps: RecoveryRemoteProviderCapabilities = {
  statusQuery: "authoritative_final",
  atomicIdempotency: true,
  epochFencing: true
};
let passed = 0;
const fixture = await setup();
try {
  const { intent, fence, ledgerA, ledgerB } = fixture;
  // The remote request might already have executed, but its ACK was lost.
  // We deliberately DO NOT invent a same-file provider receipt.
  ledgerA.markUnknown(intent.effectId, fence.epoch);
  const state = () => ledgerB.inspect(intent.effectId);
  const observation: RecoveryRemoteProviderObservation = {
    kind: "applied",
    commandId: intent.command.commandId,
    effectId: intent.effectId,
    idempotencyKey: intent.idempotencyKey,
    receiptId: "trusted-provider-receipt-123"
  };
  const decide = (
    c: RecoveryRemoteProviderCapabilities = caps,
    o: RecoveryRemoteProviderObservation | undefined = observation,
    f: RecoveryExternalEffectFence = fence
  ) => planUnknownRemoteEffectRecovery(intent, f, state(), c, o);

  check(ledgerB.claimDispatch(intent.effectId, "worker-b").action === "reconcile_required",
    "1. UNKNOWN blocks redispatch"); passed++;
  check(decide({ ...caps, statusQuery: "none" }).action === "manual_review_required",
    "2. no query: manual review"); passed++;
  check(decide({ ...caps, statusQuery: "eventually_consistent" }).action === "manual_review_required",
    "3. stale query: manual review"); passed++;
  check(decide(caps, { kind: "unknown" }).action === "manual_review_required",
    "4. unknown provider result: manual review"); passed++;
  check(decide(caps, undefined).action === "manual_review_required",
    "5. absent provider result: manual review"); passed++;
  check(decide().action === "verified_applied_requires_receipt_persistence",
    "6. authoritative applied receipt leads to persistence review"); passed++;
  check(decide(caps, { ...observation, effectId: "other-effect" }).action ===
    "manual_review_required", "7. receipt identity mismatch"); passed++;
  check(decide(caps, { ...observation, receiptId: "" }).action ===
    "manual_review_required", "8. empty receipt rejected"); passed++;
  const notApplied: RecoveryRemoteProviderObservation = {
    kind: "not_applied", commandId: intent.command.commandId,
    effectId: intent.effectId, idempotencyKey: intent.idempotencyKey,
    noLateCommitGuarantee: false
  };
  check(decide(caps, notApplied).action === "manual_review_required",
    "9. negative query without finality is not retry permission"); passed++;
  check(decide({ ...caps, atomicIdempotency: false, epochFencing: false },
    { ...notApplied, noLateCommitGuarantee: true }).action === "manual_review_required",
    "10. no downstream retry protection"); passed++;
  check(decide(caps, { ...notApplied, noLateCommitGuarantee: true }).action ===
    "verified_not_applied_requires_fresh_authorized_claim",
    "11. final negative result only permits a fresh-claim assessment"); passed++;
  check(decide(caps, observation, { ...fence, epoch: fence.epoch + 1 }).action ===
    "manual_review_required", "12. forged future epoch cannot reconcile"); passed++;
  check(state()?.status === "unknown" && state()?.epoch === 1 &&
    ledgerB.countSimulatedEffects() === 0,
    "13. advisory decisions never mutate UNKNOWN or create receipts"); passed++;
} finally {
  fixture.close();
}

// Separate proof: the *same-file mock sink* can resolve a lost ACK because its
// receipt and ledger share a single SQLite authority. This is NOT a remote rule.
const local = await setup();
try {
  check(local.ledgerA.dispatchToSameSQLiteSink(local.intent, local.fence) === "committed",
    "14. same-file sink applied the effect"); passed++;
  local.ledgerA.markUnknown(local.intent.effectId, local.fence.epoch);
  check(local.ledgerB.reconcileAgainstSameSQLiteSink(local.intent.effectId) === "committed" &&
    local.ledgerB.countSimulatedEffects() === 1 &&
    local.ledgerA.claimDispatch(local.intent.effectId, "worker-b").action === "already_committed",
    "15. trusted local receipt prevents duplicate on lost ACK"); passed++;
} finally {
  local.close();
}
check(passed === 15, "all 15 checks completed");
console.log("Day 70 evening: 15/15 remote UNKNOWN policy + same-SQLite lost-ACK checks passed");
console.log("Remote provider observations remain advisory: no production adapter or auto retry.");
