import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { InMemoryRecoveryControlStore } from "../runtime/recovery-operations.js";
import {
  DurableRecoveryOperationOrchestrator,
  RecoveryCommandIdentityConflictError,
  type DurableRecoveryOperationCommand
} from "../runtime/durable-recovery-operation-orchestrator.js";
import {
  AtomicRecoveryControlOnlyAdapter
} from "../runtime/recovery-atomic-control-only-adapter.js";
import { RecoveryEntryDispatcher } from "../runtime/recovery-entry-dispatcher.js";
import {
  RecoverySharedOwnershipConflictError
} from "../runtime/recovery-shared-ownership-claim.js";
import { RecoveryTerminalSnapshotMissingError } from "../runtime/recovery-atomic-route-decision.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";

function assert(test: unknown, message: string): asserts test {
  if (!test) throw new Error("Day 67 shared Claim: " + message);
}
const now = () => "2026-10-27T04:00:00.000Z";
let next = 0;
let passed = 0;

async function fixture() {
  await mkdir("tmp", { recursive: true });
  const id = ++next;
  const file = `tmp/day67-shared-${Date.now()}-${id}.db`;
  const runId = `day67-run-${id}`;
  const checkpointDb = new SQLiteTransactionalCheckpointDatabase(file);
  const checkpoints = new TransactionalCheckpointStore(checkpointDb);
  const checkpoint = await checkpoints.save({
    ...createInitialCheckpoint(runId),
    boundary: "reconciling_tool"
  }, 0);
  assert(checkpoint.version === 1, "fixture Checkpoint is v1");
  const left = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const right = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const command: DurableRecoveryOperationCommand = {
    commandId: `day67-command-${id}`,
    runId, operation: "quarantine", requestedBy: "operator",
    reason: "review unknown effect", expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  };
  let legacyCalls = 0;
  let atomicAuthCalls = 0;
  const authorizer = {
    authorize: async () => {
      atomicAuthCalls++;
      return { allowed: true, reason: "allowed" };
    }
  };
  const executor = {
    async execute() {
      legacyCalls++;
      const current = await checkpoints.load(runId);
      assert(current, "legacy executor loads SQLite Checkpoint");
      return {
        status: "executed" as const,
        reason: "legacy_acknowledged",
        checkpoint: current,
        controlState: {
          runId, status: "active" as const, version: 0,
          updatedAt: now()
        }
      };
    }
  };
  const legacy = new DurableRecoveryOperationOrchestrator(
    left.asLegacyCommandStore(), executor, checkpoints,
    new InMemoryRecoveryControlStore(), { now }
  );
  const atomic = new AtomicRecoveryControlOnlyAdapter(left, authorizer, now);
  const handlers = { legacy, atomic };
  return {
    command, left, right, legacy, atomic,
    dispatch: (enabled: boolean, claimer = left) =>
      new RecoveryEntryDispatcher(handlers, enabled, undefined, claimer),
    counts: () => ({ legacyCalls, atomicAuthCalls }),
    close: () => {
      right.close();
      left.close();
      checkpointDb.close();
    }
  };
}

// 1. Two physical SQLite connections: same owner can claim only once.
{
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([
      f.left.claim(f.command, "atomic_control_only"),
      f.right.claim(f.command, "atomic_control_only")
    ]);
    assert([a.action, b.action].filter(x => x === "claimed_executing").length === 1,
      "only one executing claim");
    assert([a.action, b.action].filter(x => x === "suspend_in_flight").length === 1,
      "same-owner loser suspends");
    assert(f.left.loadCommand(f.command.commandId)?.version === 2,
      "accepted v1 -> executing v2 exactly once");
    passed++;
  } finally { f.close(); }
}

// 2. Legacy claim excludes Atomic even if its own flag is ON.
{
  const f = await fixture();
  try {
    const first = await f.left.claim(f.command, "legacy");
    assert(first.action === "claimed_executing", "legacy claimed");
    let denied = false;
    try { await f.right.claim(f.command, "atomic_control_only"); }
    catch (e) { denied = e instanceof RecoverySharedOwnershipConflictError; }
    assert(denied && f.right.loadCommand(f.command.commandId)?.executionOwner === "legacy",
      "atomic cannot steal Legacy claim");
    passed++;
  } finally { f.close(); }
}

// 3. Symmetric direction: Atomic claim excludes Legacy.
{
  const f = await fixture();
  try {
    await f.left.claim(f.command, "atomic_control_only");
    let denied = false;
    try { await f.right.claim(f.command, "legacy"); }
    catch (e) { denied = e instanceof RecoverySharedOwnershipConflictError; }
    assert(denied && f.left.loadCommand(f.command.commandId)?.version === 2,
      "legacy cannot take an Atomic claim");
    passed++;
  } finally { f.close(); }
}

// 4. Immutable identity collision is rejected BEFORE route-owner comparison.
{
  const f = await fixture();
  try {
    await f.left.claim(f.command, "legacy");
    let denied = false;
    try { await f.right.claim({ ...f.command, reason: "tampered" }, "atomic_control_only"); }
    catch (e) { denied = e instanceof RecoveryCommandIdentityConflictError; }
    assert(denied && f.left.countOutbox() === 0, "tampered request cannot execute");
    passed++;
  } finally { f.close(); }
}

// 5. Historical Command without executionOwner remains unknown/fail closed.
{
  const f = await fixture();
  try {
    assert(f.left.insertCommandIfAbsent({
      ...f.command, status: "executing", version: 0,
      createdAt: now(), updatedAt: now()
    }), "seed ownerless history");
    for (const owner of ["legacy", "atomic_control_only"] as const) {
      let denied = false;
      try { await f.right.claim(f.command, owner); }
      catch (e) { denied = e instanceof RecoverySharedOwnershipConflictError; }
      assert(denied, "unknown owner is not guessed");
    }
    passed++;
  } finally { f.close(); }
}

// 6. Terminal record without a snapshot must not trigger fresh execution.
{
  const f = await fixture();
  try {
    assert(f.left.insertCommandIfAbsent({
      ...f.command, executionOwner: "atomic_control_only",
      status: "succeeded", version: 0, createdAt: now(), updatedAt: now()
    }), "seed incomplete terminal");
    let denied = false;
    try { await f.right.claim(f.command, "atomic_control_only"); }
    catch (e) { denied = e instanceof RecoveryTerminalSnapshotMissingError; }
    assert(denied && f.left.countOutbox() === 0, "missing snapshot fails closed");
    passed++;
  } finally { f.close(); }
}

// 7. Shared-Claim Dispatcher -> Atomic Prepare -> Finalizer, without re-admit.
{
  const f = await fixture();
  try {
    const first = await f.dispatch(true).execute(f.command);
    assert(first.route === "atomic_control_only" &&
      first.execution.action === "executed_new", "shared Atomic executes once");
    const terminal = f.right.loadCommand(f.command.commandId);
    assert(terminal?.version === 3 && terminal.status === "succeeded",
      "Atomic terminal is v3, not re-admission v4");
    assert(f.left.countOutbox() === 1 &&
      f.right.loadControl(f.command.runId)?.version === 1 &&
      f.right.loadCheckpoint(f.command.runId)?.version === 1,
      "Control + terminal + Outbox committed, Checkpoint unchanged");
    const replay = await f.dispatch(true, f.right).execute(f.command);
    assert(replay.route === "atomic_control_only" &&
      replay.execution.action === "replayed_terminal", "durable replay");
    assert(f.counts().atomicAuthCalls === 1 &&
      f.counts().legacyCalls === 0 && f.right.countOutbox() === 1,
      "replay has no second authorization, legacy call or Outbox");
    passed++;
  } finally { f.close(); }
}

// 8. Shared-Claim Dispatcher -> Legacy Orchestrator -> same SQLite Command row.
{
  const f = await fixture();
  try {
    const first = await f.dispatch(false).execute(f.command);
    assert(first.route === "legacy" &&
      first.execution.action === "executed_new", "shared Legacy executes");
    const terminal = f.right.loadCommand(f.command.commandId);
    assert(terminal?.status === "succeeded" && terminal.version === 3 &&
      terminal.executionOwner === "legacy", "Legacy terminal v3 in same DB");
    const replay = await f.dispatch(false, f.right).execute(f.command);
    assert(replay.route === "legacy" &&
      replay.execution.action === "replayed_terminal", "Legacy durable replay");
    assert(f.counts().legacyCalls === 1 && f.counts().atomicAuthCalls === 0,
      "Legacy executor is never called twice");
    let blocked = false;
    try { await f.dispatch(true, f.right).execute(f.command); }
    catch (e) { blocked = e instanceof RecoverySharedOwnershipConflictError; }
    assert(blocked, "flag flip does not reassign terminal owner");
    passed++;
  } finally { f.close(); }
}

// 9. Atomic POST-COMMIT lost response still replays under shared ownership.
{
  const f = await fixture();
  try {
    const faulty = new AtomicRecoveryControlOnlyAdapter(
      f.left, { authorize: async () => ({ allowed: true, reason: "allowed" }) },
      now, () => { throw new Error("lost_reply_after_commit"); }
    );
    const handlers = { legacy: f.legacy, atomic: faulty };
    const broken = new RecoveryEntryDispatcher(handlers, true, undefined, f.left);
    let failed = false;
    try { await broken.execute(f.command); }
    catch (e) { failed = (e as Error).message === "lost_reply_after_commit"; }
    assert(failed, "post-COMMIT exception reaches caller");
    const replay = await f.dispatch(true, f.right).execute(f.command);
    assert(replay.route === "atomic_control_only" &&
      replay.execution.action === "replayed_terminal" &&
      f.right.countOutbox() === 1 && f.counts().legacyCalls === 0,
      "restart only replays committed snapshot");
    passed++;
  } finally { f.close(); }
}

// 10. Mixed-route concurrent ingress: exactly one command owner wins.
{
  const f = await fixture();
  try {
    const [a, b] = await Promise.allSettled([
      f.dispatch(false, f.left).execute(f.command),
      f.dispatch(true, f.right).execute(f.command)
    ]);
    assert([a, b].filter(x => x.status === "fulfilled").length === 1,
      "only one route completes");
    const rejected = [a, b].find(x => x.status === "rejected");
    assert(rejected?.status === "rejected" &&
      rejected.reason instanceof RecoverySharedOwnershipConflictError,
      "other owner denied within SQLite transaction");
    assert(f.counts().legacyCalls + f.counts().atomicAuthCalls === 1,
      "exactly one business executor/authorizer starts");
    assert(f.left.loadCommand(f.command.commandId)?.version === 3,
      "only a single terminal record exists");
    passed++;
  } finally { f.close(); }
}

console.log(`Day 67 shared ownership Claim: ${passed}/10 passed`);
