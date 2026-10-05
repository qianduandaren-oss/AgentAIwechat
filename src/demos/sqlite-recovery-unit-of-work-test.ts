import { mkdir, rm } from "node:fs/promises";
import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import {
  RecoveryFinalizationConflictError,
  SQLiteRecoveryFinalizationUnitOfWork
} from "../runtime/sqlite-recovery-finalization.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import type { RecoveryControlState } from "../runtime/recovery-operations.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

await mkdir("tmp", { recursive: true });
const databasePath =
  `tmp/recovery-finalization-${Date.now()}.db`;

const checkpointDatabase =
  new SQLiteTransactionalCheckpointDatabase(databasePath);
const checkpointStore =
  new TransactionalCheckpointStore(checkpointDatabase);

const seed = await checkpointStore.save(
  upsertToolExecution(
    {
      ...createInitialCheckpoint("run-uow"),
      boundary: "reconciling_tool"
    },
    {
      toolCallId: "message-1",
      toolName: "send_message",
      outcome: "started",
      idempotencyKey: "message-1",
      sideEffect: "external_side_effect",
      retrySafe: false
    }
  ),
  0
);
checkpointDatabase.close();

const now = () => "2026-10-05T10:05:00.000Z";
let uow =
  new SQLiteRecoveryFinalizationUnitOfWork(
    databasePath,
    now
  );

const command: DurableRecoveryCommandRecord = {
  commandId: "cmd-uow-001",
  runId: "run-uow",
  operation: "resume",
  requestedBy: "operator",
  reason: "service recovered",
  expectedCheckpointVersion: seed.version,
  expectedControlVersion: 0,
  status: "executing",
  version: 0,
  createdAt: now(),
  updatedAt: now()
};

assert(
  uow.insertCommandIfAbsent(command),
  "durable command should be inserted before finalization"
);

const checkpoint = upsertToolExecution(
  {
    ...seed,
    boundary: "ready_for_next_step"
  },
  {
    ...seed.toolExecutions[0]!,
    outcome: "executed",
    finishedAt: now()
  }
);

const control: RecoveryControlState = {
  runId: "run-uow",
  version: 0,
  status: "active",
  reason: "resume accepted",
  updatedBy: "operator",
  updatedAt: now()
};

const succeededCommand: DurableRecoveryCommandRecord = {
  ...command,
  status: "succeeded",
  resultReason: "recovery_advanced",
  version: 1,
  updatedAt: now()
};

const outbox: RecoveryOutboxRecord[] = [
  {
    id: "outbox-audit-001",
    eventId: "event-audit-001",
    commandId: command.commandId,
    runId: command.runId,
    kind: "audit",
    payload: JSON.stringify({
      action: "recovery.resume",
      outcome: "executed"
    }),
    status: "pending",
    attempts: 0,
    version: 0,
    createdAt: now(),
    updatedAt: now()
  },
  {
    id: "outbox-recovery-001",
    eventId: "event-recovery-001",
    commandId: command.commandId,
    runId: command.runId,
    kind: "recovery_event",
    payload: JSON.stringify({
      type: "recovery_completed"
    }),
    status: "pending",
    attempts: 0,
    version: 0,
    createdAt: now(),
    updatedAt: now()
  }
];

const committed = uow.commit({
  checkpoint,
  expectedCheckpointVersion: seed.version,
  control,
  expectedControlVersion: 0,
  command: succeededCommand,
  expectedCommandVersion: 1,
  outbox
});

assert(
  committed.checkpoint.version === 2 &&
  committed.control.version === 1 &&
  committed.command.version === 2,
  "all state families should advance in one commit"
);
assert(
  uow.countOutbox() === 2,
  "required events should be pending before commit returns"
);

let conflicted = false;
try {
  uow.commit({
    checkpoint: {
      ...committed.checkpoint,
      boundary: "completed"
    },
    expectedCheckpointVersion: 1,
    control: {
      ...committed.control,
      reason: "should rollback"
    },
    expectedControlVersion: 1,
    command: {
      ...committed.command,
      status: "failed"
    },
    expectedCommandVersion: 2,
    outbox: [{
      ...outbox[0]!,
      id: "outbox-rollback",
      eventId: "event-rollback"
    }]
  });
} catch (error) {
  conflicted =
    error instanceof RecoveryFinalizationConflictError;
}

assert(
  conflicted,
  "stale checkpoint should abort the transaction"
);
assert(
  uow.loadControl("run-uow")?.reason ===
    "resume accepted",
  "rollback must preserve control state"
);
assert(
  uow.loadCommand(command.commandId)?.status ===
    "succeeded",
  "rollback must preserve command state"
);
assert(
  uow.countOutbox() === 2,
  "rollback must not leak a new outbox row"
);

uow.close();
uow =
  new SQLiteRecoveryFinalizationUnitOfWork(
    databasePath,
    now
  );

assert(
  uow.loadCheckpoint("run-uow")?.version === 2,
  "committed checkpoint should survive restart"
);
assert(
  uow.loadCommand(command.commandId)?.status ===
    "succeeded",
  "command terminal state should survive restart"
);
assert(
  uow.countOutbox() === 2,
  "pending outbox should survive restart"
);

uow.close();
await rm(databasePath, { force: true });
await rm(`${databasePath}-shm`, { force: true });
await rm(`${databasePath}-wal`, { force: true });

console.log(
  "sqlite recovery finalization unit-of-work tests passed"
);
