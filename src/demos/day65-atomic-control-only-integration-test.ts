import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import { RecoveryCommandIdentityConflictError } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Day 65 noon: " + message);
}
const now = () => "2026-10-25T04:00:00.000Z";
let serial = 0;
let passed = 0;

async function fixture(boundary: "reconciling_tool" | "completed" = "reconciling_tool") {
  await mkdir("tmp", { recursive: true });
  const n = ++serial;
  const runId = `day65-run-${n}`;
  const file = `tmp/day65-atomic-${Date.now()}-${n}.db`;
  const db = new SQLiteTransactionalCheckpointDatabase(file);
  const store = new TransactionalCheckpointStore(db);
  const cp = await store.save(
    { ...createInitialCheckpoint(runId), boundary }, 0
  );
  db.close();
  assert(cp.version === 1, "initial checkpoint v1");
  const uow = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const command: DurableRecoveryOperationCommand = {
    commandId: `day65-cmd-${n}`,
    runId,
    operation: "quarantine",
    requestedBy: "operator",
    reason: "review side effect",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  };
  return { file, uow, command };
}
const allow = { authorize: async () => ({ allowed: true, reason: "allowed" }) };
const deny = { authorize: async () => ({ allowed: false, reason: "forbidden" }) };

// (1) Feature flag off neither admits nor calls a legacy handler.
{
  const { uow, command } = await fixture();
  try {
    const adapter = new AtomicRecoveryControlOnlyAdapter(uow, allow, now);
    const answer = await adapter.execute(command, false);
    assert(answer.action === "legacy_unchanged", "flag off remains a decision");
    assert(uow.loadCommand(command.commandId) === undefined,
      "flag off has no database side effects");
    passed++;
  } finally { uow.close(); }
}

// (2) Unsupported operations are not passed to the old executor.
{
  const { uow, command } = await fixture();
  try {
    const adapter = new AtomicRecoveryControlOnlyAdapter(uow, allow, now);
    const answer = await adapter.execute({ ...command, operation: "resume" }, true);
    assert(answer.action === "unsupported_atomic_operation",
      "resume never enters control-only admission");
    assert(uow.loadCommand(command.commandId) === undefined,
      "unsupported operation not admitted");
    passed++;
  } finally { uow.close(); }
}

// (3) Fresh command -> in-file Admission/CAS -> pure Prepare -> atomic Finalize.
{
  const { uow, command } = await fixture();
  try {
    const adapter = new AtomicRecoveryControlOnlyAdapter(uow, allow, now);
    const answer = await adapter.execute(command, true);
    assert(answer.action === "executed_new", "new command executes exactly once");
    assert(answer.record.version === 3 &&
      answer.record.status === "succeeded", "v1 accepted, v2 executing, v3 terminal");
    assert(answer.resultSnapshot.status === "quarantined",
      "persisted terminal snapshot agrees with outcome");
    assert(uow.loadCheckpoint(command.runId)?.version === 1,
      "control-only Checkpoint compare does not bump version");
    assert(uow.loadControl(command.runId)?.version === 1,
      "Control CAS advances to v1");
    assert(uow.loadControl(command.runId)?.causedByCommandId === command.commandId,
      "Control records actual originating command");
    assert(uow.countOutbox() === 1, "terminal and outbox committed together");
    passed++;
  } finally { uow.close(); }
}

// (4) Simulate response loss after COMMIT; retry must only replay.
{
  const { uow, command } = await fixture();
  let authCalls = 0;
  const countedAuth = {
    authorize: async () => { authCalls++; return { allowed: true, reason: "allowed" }; }
  };
  try {
    const lost = new AtomicRecoveryControlOnlyAdapter(
      uow, countedAuth, now, () => { throw new Error("response_lost_after_commit"); }
    );
    let failed = false;
    try { await lost.execute(command, true); } catch { failed = true; }
    assert(failed, "fault injection after COMMIT raises to caller");
    const version = uow.loadCommand(command.commandId)?.version;
    const retry = await new AtomicRecoveryControlOnlyAdapter(
      uow, countedAuth, now
    ).execute(command, true);
    assert(retry.action === "replayed_terminal", "retry replays persisted result");
    assert(retry.record.version === version && version === 3,
      "retry does not do another terminal CAS");
    assert(authCalls === 1 && uow.countOutbox() === 1,
      "retry performs no extra auth/Prepare/Outbox");
    passed++;
  } finally { uow.close(); }
}

// (5) Immutable identity mismatch must not borrow prior command.
{
  const { uow, command } = await fixture();
  try {
    const adapter = new AtomicRecoveryControlOnlyAdapter(uow, allow, now);
    await adapter.execute(command, true);
    let err: unknown;
    try { await adapter.execute({ ...command, reason: "changed" }, true); }
    catch (e) { err = e; }
    assert(err instanceof RecoveryCommandIdentityConflictError,
      "same commandId with different reason fails closed");
    assert(uow.countOutbox() === 1, "no second event for changed identity");
    passed++;
  } finally { uow.close(); }
}

// (6) Already accepted/executing command is not blindly re-claimed.
{
  const { uow, command } = await fixture();
  try {
    const accepted: DurableRecoveryCommandRecord = {
      ...command, status: "accepted", version: 0,
      createdAt: now(), updatedAt: now()
    };
    assert(uow.insertCommandIfAbsent(accepted), "fixture accepted record inserted");
    const adapter = new AtomicRecoveryControlOnlyAdapter(uow, allow, now);
    const answer = await adapter.execute(command, true);
    assert(answer.action === "suspend_in_flight", "in-flight must suspend");
    assert(uow.loadCommand(command.commandId)?.version === 1,
      "in-flight version was not silently advanced");
    passed++;
  } finally { uow.close(); }
}

// (7) Denied operation terminalizes without writing Control.
{
  const { uow, command } = await fixture();
  try {
    const answer = await new AtomicRecoveryControlOnlyAdapter(
      uow, deny, now
    ).execute(command, true);
    assert(answer.action === "executed_new" &&
      answer.record.status === "rejected", "denial is durable terminal");
    assert(uow.loadControl(command.runId) === undefined,
      "denial does not insert Control");
    assert(uow.countOutbox() === 1, "denial audit outbox in same transaction");
    passed++;
  } finally { uow.close(); }
}

// (8) Completed checkpoint should produce no-op, not a Control write.
{
  const { uow, command } = await fixture("completed");
  try {
    const answer = await new AtomicRecoveryControlOnlyAdapter(
      uow, allow, now
    ).execute(command, true);
    assert(answer.action === "executed_new" &&
      answer.resultSnapshot.status === "no_op", "completed run no-op");
    assert(uow.loadControl(command.runId) === undefined,
      "no-op does not materialize Control v0");
    passed++;
  } finally { uow.close(); }
}

// (9) Two independent SQLite connections to the SAME database race safely.
{
  const { file, uow, command } = await fixture();
  const other = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  let authorizeCalls = 0;
  const countedAuth = {
    authorize: async () => {
      authorizeCalls++;
      await Promise.resolve();
      return { allowed: true, reason: "allowed" };
    }
  };
  try {
    const [a, b] = await Promise.all([
      new AtomicRecoveryControlOnlyAdapter(uow, countedAuth, now)
        .execute(command, true),
      new AtomicRecoveryControlOnlyAdapter(other, countedAuth, now)
        .execute(command, true)
    ]);
    assert([a.action, b.action].filter(x => x === "executed_new").length === 1,
      "only one contender may execute");
    assert([a.action, b.action].every(x =>
      ["executed_new", "suspend_in_flight", "replayed_terminal"].includes(x)),
      "loser must suspend or replay");
    assert(authorizeCalls === 1, "only winner executes authorization/Prepare");
    assert(uow.countOutbox() === 1 && uow.loadControl(command.runId)?.version === 1,
      "only one finalization exists");
    passed++;
  } finally { other.close(); uow.close(); }
}

console.log(`Day 65 same-DB atomic control-only integration: ${passed}/${passed} passed`);
