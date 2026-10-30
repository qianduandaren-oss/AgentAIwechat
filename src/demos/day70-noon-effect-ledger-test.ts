import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryAuthorizationEvidence } from "../runtime/recovery-authorization-evidence.js";
import {
  RecoveryExternalEffectFenceConflictError,
  type RecoveryExternalEffectIntent,
  type RecoveryExternalEffectFence
} from "../runtime/recovery-external-effect-fence.js";
import {
  RecoveryEffectLedgerConflictError,
  SQLiteRecoveryExternalEffectLedger
} from "../runtime/recovery-external-effect-ledger.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";

function check(value: unknown, why: string): asserts value {
  if (!value) throw new Error("Day 70 noon ledger: " + why);
}
function mustReject(action: () => unknown, label: string): void {
  let rejected = false;
  try { action(); }
  catch (e) {
    rejected = e instanceof RecoveryEffectLedgerConflictError ||
      e instanceof RecoveryExternalEffectFenceConflictError;
  }
  check(rejected, label);
}

let sequence = 0;
let passed = 0;
async function fixture() {
  await mkdir("tmp", { recursive: true });
  const serial = ++sequence;
  const file = "tmp/day70-noon-" + Date.now() + "-" + serial + ".db";
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file);
  const admin = new DatabaseSync(file);
  admin.exec("PRAGMA busy_timeout = 5000;");
  const runId = "run-day70-noon-" + serial;
  const command: DurableRecoveryOperationCommand = {
    commandId: "command-day70-noon-" + serial,
    runId,
    operation: "quarantine",
    requestedBy: "operator-a",
    reason: "recover ambiguous external delivery",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  };
  const evidence: RecoveryAuthorizationEvidence = {
    actorId: "operator-a", tenantId: "tenant-a",
    runId, operation: "quarantine", allowed: true,
    revisions: {
      runTenantRevision: 3,
      runAclRevision: 5,
      actorGrantRevision: 9
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
  const claimed = await finalizer.claimAuthorized(
    command, "atomic_control_only", evidence
  );
  check(claimed.action === "claimed_executing" &&
    claimed.record.authorizationFence === "same_sqlite" &&
    claimed.record.version === 2, "Day 69 authorized Command must already exist");
  const intent: RecoveryExternalEffectIntent = {
    command,
    owner: "atomic_control_only",
    effectId: "notify:" + command.commandId,
    idempotencyKey: command.commandId + ":notify",
    authorizationEvidence: evidence
  };
  const workerA = new SQLiteRecoveryExternalEffectLedger(file);
  const workerB = new SQLiteRecoveryExternalEffectLedger(file);
  return {
    intent, admin, finalizer, workerA, workerB, file,
    close() { workerB.close(); workerA.close(); admin.close(); finalizer.close(); }
  };
}
function acquire(
  ledger: SQLiteRecoveryExternalEffectLedger,
  effectId: string,
  dispatcher: string
): RecoveryExternalEffectFence {
  const claim = ledger.claimDispatch(effectId, dispatcher);
  check(claim.action === "claimed", "expected a new epoch for " + dispatcher);
  return claim.fence;
}

// 1. Two real SQLite connections compete for one pending intent.
{
  const x = await fixture();
  try {
    check(x.workerA.stageIntent(x.intent) === "pending", "durable intent pending");
    check(x.workerB.stageIntent(x.intent) === "pending", "identical staging is idempotent");
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => x.workerA.claimDispatch(x.intent.effectId, "worker-a")),
      Promise.resolve().then(() => x.workerB.claimDispatch(x.intent.effectId, "worker-b"))
    ]);
    check([a.action, b.action].filter(action => action === "claimed").length === 1,
      "only one dispatcher wins the lease");
    check([a.action, b.action].filter(action => action === "in_flight").length === 1,
      "losing dispatcher does not receive a fence");
    const fence = a.action === "claimed" ? a.fence :
      b.action === "claimed" ? b.fence : undefined;
    check(fence?.epoch === 1, "first epoch is one");
    check(x.workerA.dispatchToSameSQLiteSink(x.intent, fence) === "committed",
      "simulated sink applies once");
    x.workerB.confirmApplied(x.intent, fence);
    check(x.workerB.claimDispatch(x.intent.effectId, "again").action === "already_committed" &&
      x.workerA.countSimulatedEffects() === 1, "one receipt, durable terminal");
    passed++;
  } finally { x.close(); }
}

// 2. Immutable intent identity is enforced across connections.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    mustReject(() => x.workerB.stageIntent({
      ...x.intent, idempotencyKey: "different-key"
    }), "changed idempotency key must not overwrite");
    mustReject(() => x.workerB.stageIntent({
      ...x.intent, effectId: "other-effect"
    }), "same key may not identify another effect");
    check(x.workerA.inspect(x.intent.effectId)?.epoch === 0, "no accidental claim");
    passed++;
  } finally { x.close(); }
}

// 3. Sink committed but worker lost reply: UNKNOWN requires reconciliation.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const fence = acquire(x.workerA, x.intent.effectId, "worker-a");
    check(x.workerA.dispatchToSameSQLiteSink(x.intent, fence) === "committed",
      "provider-side commit happened");
    x.workerA.markUnknown(x.intent.effectId, fence.epoch);
    check(x.workerB.claimDispatch(x.intent.effectId, "worker-b").action === "reconcile_required",
      "lost response is not a license to resend");
    check(x.workerB.reconcileAgainstSameSQLiteSink(x.intent.effectId) === "committed",
      "trusted local receipt resolves UNKNOWN");
    check(x.workerA.inspect(x.intent.effectId)?.status === "committed" &&
      x.workerA.countSimulatedEffects() === 1, "no duplicate external effect");
    passed++;
  } finally { x.close(); }
}

// 4. No sink receipt: local-sink reconciliation and a strictly newer epoch.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const old = acquire(x.workerA, x.intent.effectId, "worker-a");
    x.workerA.markUnknown(x.intent.effectId, old.epoch);
    check(x.workerB.claimDispatch(x.intent.effectId, "worker-b").action === "reconcile_required",
      "UNKNOWN never auto-reclaimed");
    check(x.workerB.reconcileAgainstSameSQLiteSink(x.intent.effectId) === "ready_for_new_epoch",
      "same-file sink has no committed receipt");
    const next = acquire(x.workerB, x.intent.effectId, "worker-b");
    check(next.epoch === 2, "takeover increments epoch");
    mustReject(
      () => x.workerA.dispatchToSameSQLiteSink(x.intent, old),
      "old worker token is stale after takeover"
    );
    mustReject(
      () => x.workerA.confirmApplied(x.intent, old),
      "old worker cannot claim the new epoch's effect"
    );
    check(x.workerB.dispatchToSameSQLiteSink(x.intent, next) === "committed",
      "new worker may commit");
    x.workerB.confirmApplied(x.intent, next);
    check(x.workerA.countSimulatedEffects() === 1, "single effect receipt");
    passed++;
  } finally { x.close(); }
}

// 5. Retrying an accepted fence is deduped at the simulated sink.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const fence = acquire(x.workerA, x.intent.effectId, "worker-a");
    check(x.workerA.dispatchToSameSQLiteSink(x.intent, fence) === "committed",
      "first dispatch applied");
    check(x.workerB.dispatchToSameSQLiteSink(x.intent, fence) === "already_applied",
      "same key returns durable receipt, not another effect");
    x.workerA.confirmApplied(x.intent, fence);
    check(x.workerA.countSimulatedEffects() === 1, "receipt count stays one");
    passed++;
  } finally { x.close(); }
}

// 6. Current ACL revoked after lease: no sink effect despite old valid fence.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const fence = acquire(x.workerA, x.intent.effectId, "worker-a");
    x.admin.prepare(
      "UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10 WHERE actor_id='operator-a'"
    ).run();
    mustReject(
      () => x.workerB.dispatchToSameSQLiteSink(x.intent, fence),
      "revocation inside sink transaction must deny");
    check(x.workerA.countSimulatedEffects() === 0 &&
      x.workerA.inspect(x.intent.effectId)?.status === "leased",
      "no receipt or fake success");
    passed++;
  } finally { x.close(); }
}

// 7. An unfenced or missing durable Command cannot stage an effect.
{
  const x = await fixture();
  try {
    x.admin.prepare("DELETE FROM recovery_commands WHERE command_id=?")
      .run(x.intent.command.commandId);
    mustReject(() => x.workerA.stageIntent(x.intent), "missing claimed Command denied");
    check(!x.workerA.inspect(x.intent.effectId) &&
      x.workerA.countSimulatedEffects() === 0, "no intent or receipt");
    passed++;
  } finally { x.close(); }
}

// 8. Epoch and UNKNOWN survive a database connection restart.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const old = acquire(x.workerA, x.intent.effectId, "worker-a");
    x.workerA.markUnknown(x.intent.effectId, old.epoch);
    const restarted = new SQLiteRecoveryExternalEffectLedger(x.file);
    try {
      check(restarted.inspect(x.intent.effectId)?.epoch === 1 &&
        restarted.claimDispatch(x.intent.effectId, "restart").action === "reconcile_required",
        "durable unknown survives worker restart");
      restarted.reconcileAgainstSameSQLiteSink(x.intent.effectId);
      const newFence = acquire(restarted, x.intent.effectId, "restart");
      check(newFence.epoch === 2, "epoch persisted and incremented across restart");
      passed++;
    } finally { restarted.close(); }
  } finally { x.close(); }
}

// 9. An untrusted or mixed-command fence is rejected before sink writes.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    const fence = acquire(x.workerA, x.intent.effectId, "worker-a");
    mustReject(() => x.workerA.dispatchToSameSQLiteSink(x.intent, {
      ...fence, commandId: "other-command"
    }), "wrong command binding");
    mustReject(() => x.workerA.dispatchToSameSQLiteSink(x.intent, {
      ...fence, epoch: fence.epoch + 1
    }), "future forged epoch");
    check(x.workerB.countSimulatedEffects() === 0, "zero writes for bad fence");
    passed++;
  } finally { x.close(); }
}

// 10. Tampered grant revision between stage and lease also blocks dispatch.
{
  const x = await fixture();
  try {
    x.workerA.stageIntent(x.intent);
    x.admin.prepare(
      "UPDATE recovery_authority_runs SET acl_revision=6 WHERE run_id=?"
    ).run(x.intent.command.runId);
    mustReject(
      () => x.workerB.claimDispatch(x.intent.effectId, "worker-b"),
      "stale resource revision rejected at dispatch claim"
    );
    check(x.workerB.inspect(x.intent.effectId)?.epoch === 0,
      "no epoch granted for stale ACL");
    passed++;
  } finally { x.close(); }
}

check(passed === 10, "all ten integration scenarios complete");
console.log("Day 70 noon: 10/10 same-SQLite effect ledger integration scenarios passed");
console.log("This is an atomic LOCAL sink simulation, not external provider exactly-once.");
