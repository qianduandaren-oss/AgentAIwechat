import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import type { AgentRunCheckpoint } from "../runtime/checkpoint.js";
import { prepareControlOnlyRecovery } from "../runtime/recovery-control-preparation.js";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryControlState } from "../runtime/recovery-operations.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Day 64 evening: " + message);
}
const timestamp = "2026-10-24T10:00:00.000Z";
const runId = "day64-preparation-run";
const command: DurableRecoveryOperationCommand = {
  commandId: "day64-preparation-command",
  runId,
  operation: "quarantine",
  requestedBy: "operator",
  reason: "investigate unknown tool outcome",
  expectedCheckpointVersion: 1,
  expectedControlVersion: 0
};
const checkpoint: AgentRunCheckpoint = {
  ...createInitialCheckpoint(runId),
  version: 1,
  boundary: "reconciling_tool"
};
const allowed = { allowed: true, reason: "allowed" };
const prepare = (overrides: Parameters<typeof prepareControlOnlyRecovery>[0] = {
  command, checkpoint, authorization: allowed, timestamp
}) => prepareControlOnlyRecovery(overrides);

// 1. Pure preparation plans only a Control write; inputs are never mutated.
const prepared = prepare();
assert(prepared.outcome === "applied", "quarantine should be applied");
assert(prepared.writeSet.checkpoint === "compare", "Checkpoint is Read Set only");
assert(prepared.writeSet.control === "cas_update", "Control must be updated");
assert(prepared.control.causedByCommandId === command.commandId, "new origin is recorded");
assert(prepared.control.version === 0, "prepared draft must not invent persisted version");
assert(checkpoint.causedByCommandId === undefined, "Checkpoint input stays unchanged");

// 2. Permission denied: do not persist any state mutation.
const denied = prepare({
  command, checkpoint, authorization: { allowed: false, reason: "forbidden" },
  timestamp
});
assert(denied.outcome === "rejected", "denial must be rejected");
assert(denied.writeSet.control === "compare", "denial must not write Control");

// 3. A completed checkpoint produces a no-op; no Control row is created.
const completed = prepare({
  command, checkpoint: { ...checkpoint, boundary: "completed" },
  authorization: allowed, timestamp
});
assert(completed.outcome === "no_op", "completed checkpoint should be no-op");
assert(completed.writeSet.control === "compare", "no-op must not write");

// 4. An already quarantined Control state also stays unchanged.
const quarantined: RecoveryControlState = {
  runId, version: 1, status: "quarantined", updatedAt: timestamp
};
const already = prepare({
  command: { ...command, expectedControlVersion: 1 },
  checkpoint, control: quarantined, authorization: allowed, timestamp
});
assert(already.outcome === "no_op", "duplicate quarantine must be no-op");
assert(already.control.version === 1, "existing version stays the same");

// 5. Release requires a prior quarantine; valid release prepares active.
const wrongRelease = prepare({
  command: { ...command, operation: "release_quarantine" },
  checkpoint, authorization: allowed, timestamp
});
assert(wrongRelease.outcome === "rejected", "release without quarantine rejected");
const release = prepare({
  command: { ...command, operation: "release_quarantine", expectedControlVersion: 1 },
  checkpoint, control: quarantined, authorization: allowed, timestamp
});
assert(release.outcome === "applied" && release.control.status === "active",
  "valid release prepares active Control");

// 6. Identity mismatch and unsupported operations fail closed.
let identityFailed = false;
try {
  prepare({ command, checkpoint: { ...checkpoint, runId: "wrong-run" }, authorization: allowed, timestamp });
} catch { identityFailed = true; }
assert(identityFailed, "mismatched runId must fail");
let unsupportedFailed = false;
try {
  prepare({
    command: { ...command, operation: "resume" },
    checkpoint, authorization: allowed, timestamp
  });
} catch { unsupportedFailed = true; }
assert(unsupportedFailed, "resume requires Coordinator, never silently treated as control-only");

// 7. Real SQLite: the prepared effect is committed once by Finalizer only.
await mkdir("tmp", { recursive: true });
const file = "tmp/day64-control-preparation-" + Date.now() + ".db";
const checkpointDb = new SQLiteTransactionalCheckpointDatabase(file);
const checkpointStore = new TransactionalCheckpointStore(checkpointDb);
const initial = await checkpointStore.save(
  { ...createInitialCheckpoint(runId), boundary: "reconciling_tool" },
  0
);
checkpointDb.close();
assert(initial.version === 1, "fixture stores checkpoint v1");
const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file, () => timestamp);
try {
  const accepted: DurableRecoveryCommandRecord = {
    ...command, status: "executing", version: 0,
    createdAt: timestamp, updatedAt: timestamp
  };
  assert(finalizer.insertCommandIfAbsent(accepted), "command must be inserted");
  const event: RecoveryOutboxRecord = {
    id: "day64-prep-outbox", eventId: "day64-prep-event",
    commandId: command.commandId, runId, kind: "audit",
    payload: JSON.stringify({ reason: prepared.reason }),
    status: "pending", attempts: 0, version: 0,
    createdAt: timestamp, updatedAt: timestamp
  };
  const committed = finalizer.commit({
    checkpoint: prepared.checkpoint,
    expectedCheckpointVersion: prepared.expectedCheckpointVersion,
    control: prepared.control,
    expectedControlVersion: prepared.expectedControlVersion,
    command: {
      ...accepted, status: "succeeded", version: 1,
      resultReason: prepared.reason,
      resultSnapshot: {
        status: prepared.status, reason: prepared.reason,
        checkpointVersion: 1, controlVersion: 1
      }
    },
    expectedCommandVersion: 1,
    outbox: [event],
    writeSet: prepared.writeSet
  });
  assert(committed.checkpoint.version === 1, "real SQLite checkpoint stays v1");
  assert(committed.control.version === 1, "real SQLite control advances to v1");
  assert(committed.control.causedByCommandId === command.commandId,
    "persisted origin is correct");
  assert(finalizer.countOutbox() === 1, "outbox was inserted atomically");
  assert(finalizer.loadCommand(command.commandId)?.status === "succeeded",
    "command terminal was committed");
} finally {
  finalizer.close();
}
console.log("Day 64 pure Control preparation + SQLite Finalizer: 7/7 passed");
