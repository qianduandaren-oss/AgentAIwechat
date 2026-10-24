import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import {
  RecoveryFinalizationConflictError,
  SQLiteRecoveryFinalizationUnitOfWork,
  type RecoveryFinalizationInput
} from "../runtime/sqlite-recovery-finalization.js";
import { planRecoveryWriteSet } from "../runtime/recovery-write-set.js";
import type { RecoveryOperation } from "../runtime/recovery-operations.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";
import type { RecoveryControlState } from "../runtime/recovery-operations.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

function assert(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${description}`);
}
const now = () => "2026-10-24T04:00:00.000Z";
let counter = 0;

async function fixture(
  operation: RecoveryOperation = "quarantine"
) {
  await mkdir("tmp", { recursive: true });
  const serial = ++counter;
  const runId = `day64-run-${serial}`;
  const file = `tmp/day64-finalizer-${Date.now()}-${serial}.db`;
  const checkpointDb = new SQLiteTransactionalCheckpointDatabase(file);
  const checkpointStore = new TransactionalCheckpointStore(checkpointDb);
  const checkpoint = await checkpointStore.save(
    { ...createInitialCheckpoint(runId), boundary: "reconciling_tool" },
    0
  );
  checkpointDb.close();

  const uow = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const accepted: DurableRecoveryCommandRecord = {
    commandId: `day64-cmd-${serial}`,
    runId,
    operation,
    requestedBy: "operator",
    reason: "incident reviewed",
    expectedCheckpointVersion: checkpoint.version,
    expectedControlVersion: 0,
    status: "executing",
    version: 0,
    createdAt: now(),
    updatedAt: now()
  };
  assert(uow.insertCommandIfAbsent(accepted), "initial command inserted");
  const control: RecoveryControlState = {
    runId,
    version: 0,
    status: operation === "quarantine" ? "quarantined" : "active",
    updatedAt: now(),
    updatedBy: "operator"
  };
  const command: DurableRecoveryCommandRecord = {
    ...accepted,
    status: "succeeded",
    version: 1,
    resultReason: "prepared_effect_applied",
    resultSnapshot: {
      status: operation === "quarantine" ? "quarantined" : "executed",
      reason: "prepared_effect_applied",
      checkpointVersion: checkpoint.version,
      controlVersion: 1
    }
  };
  const event: RecoveryOutboxRecord = {
    id: `day64-outbox-${serial}`,
    eventId: `day64-event-${serial}`,
    commandId: accepted.commandId,
    runId,
    kind: "audit",
    payload: JSON.stringify({ action: `recovery.${operation}` }),
    status: "pending",
    attempts: 0,
    version: 0,
    createdAt: now(),
    updatedAt: now()
  };
  const input: RecoveryFinalizationInput = {
    checkpoint: { ...checkpoint, boundary: "completed" },
    expectedCheckpointVersion: checkpoint.version,
    control,
    expectedControlVersion: 0,
    command,
    expectedCommandVersion: 1,
    outbox: [event],
    writeSet: planRecoveryWriteSet({
      operation,
      outcome: "applied",
      checkpointChanged: false,
      controlChanged: true
    })
  };
  return { uow, file, checkpoint, input, event };
}

function conflicts(run: () => unknown, entity?: string): void {
  let thrown: unknown;
  try { run(); } catch (error) { thrown = error; }
  assert(thrown instanceof RecoveryFinalizationConflictError,
    "must reject with a typed finalization conflict");
  if (entity) assert(thrown.entity === entity,
    `expected conflict on ${entity}`);
}

// 1. The control-only transaction reads checkpoint v1 but does NOT update it.
{
  const { uow, checkpoint, input } = await fixture();
  try {
    const committed = uow.commit(input);
    assert(committed.checkpoint.version === checkpoint.version,
      "compare-only returns persisted checkpoint v1");
    assert(committed.checkpoint.boundary === "reconciling_tool",
      "compare-only returns persisted payload, not the draft");
    assert(uow.loadCheckpoint(checkpoint.runId)?.version === 1,
      "checkpoint version not bumped");
    assert(uow.loadControl(checkpoint.runId)?.version === 1,
      "control inserted at version 1");
    assert(uow.loadCommand(input.command.commandId)?.status === "succeeded",
      "command terminal persisted");
    assert(uow.countOutbox() === 1, "outbox persisted");
  } finally { uow.close(); }
}

// 2. Version drift on a compare-only checkpoint still rejects transaction.
{
  const { uow, file, checkpoint, input } = await fixture();
  try {
    const external = new DatabaseSync(file);
    const updated = { ...checkpoint, version: 2, updatedAt: now() };
    const written = external.prepare(`
      UPDATE agent_checkpoints
      SET version = ?, payload = ?, updated_at = ?
      WHERE run_id = ? AND version = ?
    `).run(2, JSON.stringify(updated), now(), checkpoint.runId, 1);
    assert(Number(written.changes) === 1, "concurrent update performed");
    external.close();
    conflicts(() => uow.commit(input), "checkpoint");
    assert(uow.loadCheckpoint(checkpoint.runId)?.version === 2,
      "concurrent version survives");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "no partial control insert");
    assert(uow.loadCommand(input.command.commandId)?.status === "executing",
      "command unchanged");
    assert(uow.countOutbox() === 0, "outbox unchanged");
  } finally { uow.close(); }
}

// 3. Outbox event_id UNIQUE failure after writes rolls back EVERYTHING.
{
  const { uow, checkpoint, input, event } = await fixture();
  try {
    let failed = false;
    try {
      uow.commit({
        ...input,
        outbox: [event, { ...event, id: event.id + "-second" }]
      });
    } catch { failed = true; }
    assert(failed, "duplicate event ID rejected");
    assert(uow.loadCheckpoint(checkpoint.runId)?.version === 1,
      "checkpoint untouched");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "control insertion rolled back");
    assert(uow.loadCommand(input.command.commandId)?.status === "executing",
      "terminal update rolled back");
    assert(uow.countOutbox() === 0, "first inserted outbox also rolled back");
  } finally { uow.close(); }
}

// 4. A compare-only Control read must not materialize an absent v0 row.
{
  const { uow, checkpoint, input } = await fixture();
  try {
    const committed = uow.commit({
      ...input,
      writeSet: {
        checkpoint: "compare",
        control: "compare",
        command: "terminal_cas",
        outbox: "append_prepared_events"
      }
    });
    assert(committed.control.version === 0, "derived control remains v0");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "no control row inserted");
    assert(uow.loadCheckpoint(checkpoint.runId)?.version === 1,
      "no checkpoint version bump");
  } finally { uow.close(); }
}

// 5. Old callers still update both state rows when writeSet is omitted.
{
  const { uow, checkpoint, input } = await fixture();
  try {
    const committed = uow.commit({ ...input, writeSet: undefined });
    assert(committed.checkpoint.version === 2, "legacy checkpoint bumps");
    assert(committed.control.version === 1, "legacy control inserted");
    assert(uow.loadCheckpoint(checkpoint.runId)?.version === 2,
      "legacy checkpoint persisted");
  } finally { uow.close(); }
}

// 6. A changed immutable request cannot borrow an existing commandId.
{
  const { uow, checkpoint, input } = await fixture();
  try {
    conflicts(() => uow.commit({
      ...input,
      command: { ...input.command, reason: "different request" }
    }), "command_identity_or_status");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "identity mismatch rolls back control");
    assert(uow.countOutbox() === 0, "identity mismatch rolls back outbox");
  } finally { uow.close(); }
}

// 7. Outbox command/run identity must match the bound command.
{
  const { uow, checkpoint, input, event } = await fixture();
  try {
    conflicts(() => uow.commit({
      ...input,
      outbox: [{ ...event, commandId: "unrelated-command" }]
    }), "outbox_identity");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "outbox mismatch rolls back controls");
  } finally { uow.close(); }
}

// 8. A checkpoint-only recovery can CAS checkpoint, compare absent control.
{
  const { uow, checkpoint, input } = await fixture("retry_recovery");
  try {
    const committed = uow.commit({
      ...input,
      writeSet: planRecoveryWriteSet({
        operation: "retry_recovery",
        outcome: "applied",
        checkpointChanged: true,
        controlChanged: false
      })
    });
    assert(committed.checkpoint.version === 2, "checkpoint CAS applied");
    assert(uow.loadControl(checkpoint.runId) === undefined,
      "control only compared, not inserted");
  } finally { uow.close(); }
}

// 9. Re-finalizing the same terminal command must fail, never append.
{
  const { uow, input } = await fixture();
  try {
    uow.commit(input);
    conflicts(() => uow.commit({
      ...input,
      expectedCheckpointVersion: 1,
      expectedControlVersion: 1
    }));
    assert(uow.countOutbox() === 1, "no duplicate outbox");
  } finally { uow.close(); }
}

console.log("Day 64 selective SQLite Finalizer integration: 9/9 passed");
