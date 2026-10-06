import { mkdir } from "node:fs/promises";
import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import {
  CheckpointRecoveryCoordinator
} from "../runtime/checkpoint-recovery-coordinator.js";
import type {
  DurableRecoveryCommandRecord
} from "../runtime/recovery-command-store.js";
import type {
  RecoveryOutboxRecord
} from "../runtime/recovery-outbox.js";
import type {
  RecoveryControlState
} from "../runtime/recovery-operations.js";
import {
  ReconcilerRegistry
} from "../runtime/reconciler.js";
import {
  SQLiteTransactionalCheckpointDatabase
} from "../runtime/sqlite-checkpoint-database.js";
import {
  SQLiteRecoveryFinalizationUnitOfWork
} from "../runtime/sqlite-recovery-finalization.js";
import {
  SQLiteRecoveryTransitionCommitter
} from "../runtime/sqlite-recovery-transition-committer.js";
import {
  TransactionalCheckpointStore
} from "../runtime/transactional-checkpoint-store.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(
      `Assertion failed: ${message}`
    );
  }
}

await mkdir("tmp", {
  recursive: true
});

const databasePath =
  `tmp/recovery-transition-committer-${Date.now()}.db`;

const checkpointDatabase =
  new SQLiteTransactionalCheckpointDatabase(
    databasePath
  );

const checkpointStore =
  new TransactionalCheckpointStore(
    checkpointDatabase
  );

const seeded =
  await checkpointStore.save(
    upsertToolExecution(
      {
        ...createInitialCheckpoint(
          "run-day46-evening"
        ),
        step: 9,
        boundary:
          "reconciling_tool"
      },
      {
        toolCallId:
          "message-call-day46",
        toolName:
          "send_message",
        outcome:
          "started",
        idempotencyKey:
          "message-day46-evening",
        sideEffect:
          "external_side_effect",
        retrySafe: false
      }
    ),
    0
  );

assert(
  seeded.version === 1,
  "seed checkpoint should be v1"
);

const now =
  () =>
    "2026-10-06T10:00:00.000Z";

let unitOfWork =
  new SQLiteRecoveryFinalizationUnitOfWork(
    databasePath,
    now
  );

const command:
  DurableRecoveryCommandRecord = {
    commandId:
      "cmd-day46-evening-001",
    runId:
      seeded.runId,
    operation:
      "reconcile_again",
    requestedBy:
      "operator",
    reason:
      "external message service recovered",
    expectedCheckpointVersion:
      seeded.version,
    expectedControlVersion: 0,
    status:
      "executing",
    version: 0,
    createdAt: now(),
    updatedAt: now()
  };

assert(
  unitOfWork.insertCommandIfAbsent(
    command
  ),
  "durable recovery command should be inserted"
);

const storedCommand =
  unitOfWork.loadCommand(
    command.commandId
  );

assert(
  storedCommand?.version === 1,
  "inserted command should start at durable version 1"
);

const control:
  RecoveryControlState = {
    runId:
      seeded.runId,
    version: 0,
    status: "active",
    reason:
      "operator requested reconciliation",
    updatedBy:
      command.requestedBy,
    updatedAt:
      now()
  };

const outbox:
  RecoveryOutboxRecord[] = [
    {
      id:
        "outbox-day46-audit",
      eventId:
        "event-day46-audit",
      commandId:
        command.commandId,
      runId:
        command.runId,
      kind:
        "audit",
      payload:
        JSON.stringify({
          action:
            "recovery.reconcile_again",
          outcome:
            "executed"
        }),
      status:
        "pending",
      attempts: 0,
      version: 0,
      createdAt: now(),
      updatedAt: now()
    },
    {
      id:
        "outbox-day46-recovery",
      eventId:
        "event-day46-recovery",
      commandId:
        command.commandId,
      runId:
        command.runId,
      kind:
        "recovery_event",
      payload:
        JSON.stringify({
          type:
            "recovery_completed"
        }),
      status:
        "pending",
      attempts: 0,
      version: 0,
      createdAt: now(),
      updatedAt: now()
    }
  ];

const registry =
  new ReconcilerRegistry();

registry.register(
  "send_message",
  {
    async reconcile() {
      return "executed";
    }
  }
);

const committer =
  new SQLiteRecoveryTransitionCommitter(
    unitOfWork,
    prepared => ({
      control,
      expectedControlVersion: 0,
      command: {
        ...command,
        status: "succeeded",
        version:
          storedCommand?.version ?? 1,
        resultReason:
          `recovery_${prepared.status}`,
        updatedAt:
          now()
      },
      expectedCommandVersion:
        storedCommand?.version ?? 1,
      outbox
    })
  );

const coordinator =
  new CheckpointRecoveryCoordinator(
    checkpointStore,
    registry,
    {
      committer,
      attemptIdFactory:
        () =>
          "recovery-day46-evening",
      now
    }
  );

const result =
  await coordinator.recover(
    seeded.runId
  );

assert(
  result.status === "advanced",
  "recovery should advance after reconciliation"
);

assert(
  result.checkpoint.version === 2,
  "transaction commit should allocate checkpoint v2"
);

assert(
  result.checkpoint.boundary ===
    "ready_for_next_step",
  "recovery should advance to the next step"
);

assert(
  result.checkpoint
    .toolExecutions[0]
    ?.outcome === "executed",
  "reconciled tool outcome should be persisted"
);

assert(
  unitOfWork
    .loadControl(seeded.runId)
    ?.version === 1,
  "control state should commit in the same transaction"
);

assert(
  unitOfWork
    .loadCommand(command.commandId)
    ?.status === "succeeded",
  "durable command should become terminal in the same transaction"
);

assert(
  unitOfWork.countOutbox() === 2,
  "required audit and recovery events should be pending before commit returns"
);

checkpointDatabase.close();
unitOfWork.close();

unitOfWork =
  new SQLiteRecoveryFinalizationUnitOfWork(
    databasePath,
    now
  );

assert(
  unitOfWork
    .loadCheckpoint(seeded.runId)
    ?.version === 2,
  "checkpoint should survive process restart"
);

assert(
  unitOfWork
    .loadCommand(command.commandId)
    ?.status === "succeeded",
  "durable command should survive process restart"
);

assert(
  unitOfWork.countOutbox() === 2,
  "pending outbox should survive process restart"
);

unitOfWork.close();

console.log(
  "sqlite recovery transition committer integration tests passed"
);
