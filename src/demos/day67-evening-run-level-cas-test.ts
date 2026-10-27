import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { InMemoryRecoveryControlStore } from "../runtime/recovery-operations.js";
import { DurableRecoveryOperationOrchestrator, type DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import { ClaimRequiredRecoveryEntry, RecoveryClaimRequiredError } from "../runtime/recovery-claim-required-entry.js";
import { RecoverySharedOwnershipConflictError } from "../runtime/recovery-shared-ownership-claim.js";
import { SQLiteRecoveryFinalizationUnitOfWork, RecoveryFinalizationConflictError } from "../runtime/sqlite-recovery-finalization.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Day 67 evening: " + message);
}
const now = () => "2026-10-27T10:00:00.000Z";
let counter = 0;
let passed = 0;

async function fixture() {
  await mkdir("tmp", { recursive: true });
  const id = ++counter;
  const file = `tmp/day67-evening-${Date.now()}-${id}.db`;
  const runId = `day67-evening-run-${id}`;
  const checkpointDb = new SQLiteTransactionalCheckpointDatabase(file);
  const checkpoints = new TransactionalCheckpointStore(checkpointDb);
  const checkpoint = await checkpoints.save({
    ...createInitialCheckpoint(runId), boundary: "reconciling_tool"
  }, 0);
  assert(checkpoint.version === 1, "checkpoint seed v1");
  const left = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const right = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  let atomicAuthorizations = 0;
  let legacyExecutions = 0;
  const authorizer = {
    authorize: async () => {
      atomicAuthorizations++;
      return { allowed: true, reason: "allowed" };
    }
  };
  const legacy = new DurableRecoveryOperationOrchestrator(
    left.asLegacyCommandStore(),
    {
      async execute() {
        legacyExecutions++;
        throw new Error("Legacy business writer must not run in atomic test");
      }
    },
    checkpoints,
    new InMemoryRecoveryControlStore(),
    { now }
  );
  const atomicLeft = new AtomicRecoveryControlOnlyAdapter(left, authorizer, now);
  const atomicRight = new AtomicRecoveryControlOnlyAdapter(right, authorizer, now);
  const command = (
    commandId: string,
    operation: DurableRecoveryOperationCommand["operation"] = "quarantine",
    expectedControlVersion = 0
  ): DurableRecoveryOperationCommand => ({
    commandId, runId, operation, requestedBy: "operator",
    reason: "inspect durable effect", expectedCheckpointVersion: 1,
    expectedControlVersion
  });
  return {
    left, right, command, legacy, atomicLeft, atomicRight,
    entry: (enabled: boolean, claimer = left) => new ClaimRequiredRecoveryEntry(
      { legacy, atomic: atomicLeft }, enabled, claimer
    ),
    counts: () => ({ atomicAuthorizations, legacyExecutions }),
    close: () => {
      right.close();
      left.close();
      checkpointDb.close();
    }
  };
}

// 1-3. No opt-out from shared Claim at the candidate ingress.
{
  const f = await fixture();
  try {
    const handlers = { legacy: f.legacy, atomic: f.atomicLeft };
    let rejected = false;
    try { new ClaimRequiredRecoveryEntry(handlers, true, undefined); }
    catch (e) { rejected = e instanceof RecoveryClaimRequiredError; }
    assert(rejected, "missing claimer fails before any request");
    passed++;
    rejected = false;
    try {
      new ClaimRequiredRecoveryEntry(
        { legacy: { execute: async () => { throw new Error("not called"); } }, atomic: f.atomicLeft },
        false, f.left
      );
    } catch (e) { rejected = e instanceof RecoveryClaimRequiredError; }
    assert(rejected, "legacy must support executeClaimed");
    passed++;
    rejected = false;
    try {
      new ClaimRequiredRecoveryEntry(
        { legacy: f.legacy, atomic: { execute: async () => { throw new Error("not called"); } } },
        true, f.left
      );
    } catch (e) { rejected = e instanceof RecoveryClaimRequiredError; }
    assert(rejected, "atomic must support executeClaimed");
    assert(f.left.countOutbox() === 0, "constructor rejection has no writes");
    passed++;
  } finally { f.close(); }
}

// 4-5. Different commandIds can BOTH claim executing, but only the FIRST
// terminal update for the same Run/control expected v0 can succeed.
for (const reverse of [false, true]) {
  const f = await fixture();
  try {
    const a = f.command(`a-${reverse}`);
    const b = f.command(`b-${reverse}`);
    const ca = await f.left.claim(a, "atomic_control_only");
    const cb = await f.right.claim(b, "atomic_control_only");
    assert(ca.action === "claimed_executing" && cb.action === "claimed_executing",
      "commandId ownership is NOT a Run-level lock");
    const winner = reverse
      ? await f.atomicRight.executeClaimed(b, cb)
      : await f.atomicLeft.executeClaimed(a, ca);
    assert(winner.action === "executed_new", "winning command committed");
    const loserCommand = reverse ? a : b;
    const loserClaim = reverse ? ca : cb;
    const loserAdapter = reverse ? f.atomicLeft : f.atomicRight;
    let failed = false;
    try { await loserAdapter.executeClaimed(loserCommand, loserClaim); }
    catch (e) {
      failed = e instanceof RecoveryFinalizationConflictError &&
        e.entity === "control";
    }
    assert(failed, "stale Control v0 rejected in finalizer transaction");
    assert(f.right.loadCommand(loserCommand.commandId)?.status === "executing" &&
      f.right.loadCommand(loserCommand.commandId)?.version === 2,
      "losing Command stays in-flight, not forged terminal");
    assert(f.left.loadControl(a.runId)?.version === 1 &&
      f.left.loadControl(a.runId)?.causedByCommandId === (reverse ? b : a).commandId,
      "exactly one Control mutation persisted");
    assert(f.left.loadCheckpoint(a.runId)?.version === 1 &&
      f.right.countOutbox() === 1,
      "Checkpoint unchanged and Outbox written once");
    assert(f.counts().legacyExecutions === 0, "never falls back to Legacy");
    passed++;
  } finally { f.close(); }
}

// 6. Correct new expectedControlVersion allows the next legitimate transition.
{
  const f = await fixture();
  try {
    const first = f.command("quarantine-one");
    const c1 = await f.left.claim(first, "atomic_control_only");
    assert(c1.action === "claimed_executing", "first claimed");
    const r1 = await f.atomicLeft.executeClaimed(first, c1);
    assert(r1.action === "executed_new", "first committed");
    const second = f.command("release-two", "release_quarantine", 1);
    const c2 = await f.right.claim(second, "atomic_control_only");
    assert(c2.action === "claimed_executing", "second claimed");
    const r2 = await f.atomicRight.executeClaimed(second, c2);
    assert(r2.action === "executed_new", "fresh-version release committed");
    assert(f.left.loadControl(first.runId)?.version === 2 &&
      f.left.loadControl(first.runId)?.status === "active" &&
      f.right.countOutbox() === 2,
      "two explicit sequential changes produce two events");
    passed++;
  } finally { f.close(); }
}

// 7. Strict entry and owner-flip check: existing Atomic owner cannot fall
// through to a Legacy writer even after switching the configured flag.
{
  const f = await fixture();
  try {
    const request = f.command("owner-stays-atomic");
    const first = await f.entry(true).execute(request);
    assert(first.route === "atomic_control_only" &&
      first.execution.action === "executed_new", "strict atomic entry committed");
    const replay = await f.entry(true, f.right).execute(request);
    assert(replay.route === "atomic_control_only" &&
      replay.execution.action === "replayed_terminal", "strict replay");
    let denied = false;
    try { await f.entry(false, f.right).execute(request); }
    catch (e) { denied = e instanceof RecoverySharedOwnershipConflictError; }
    assert(denied && f.counts().legacyExecutions === 0 &&
      f.counts().atomicAuthorizations === 1 && f.left.countOutbox() === 1,
      "flag flip does not change owner or repeat side effects");
    passed++;
  } finally { f.close(); }
}

console.log(`Day 67 evening Run-level CAS / claim-required ingress: ${passed}/7 passed`);
