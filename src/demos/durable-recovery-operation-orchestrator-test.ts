import {
  createInitialCheckpoint
} from "../runtime/checkpoint.js";
import {
  InMemoryCheckpointStore
} from "../runtime/checkpoint-store.js";
import {
  DurableRecoveryOperationOrchestrator,
  RecoveryCommandIdentityConflictError,
  type DurableRecoveryOperationCommand,
  type RecoveryOperationExecutor
} from "../runtime/durable-recovery-operation-orchestrator.js";
import {
  InMemoryRecoveryCommandStore,
  type DurableRecoveryCommandRecord
} from "../runtime/recovery-command-store.js";
import {
  InMemoryRecoveryControlStore,
  type RecoveryControlState,
  type RecoveryOperationCommand,
  type RecoveryOperationResult
} from "../runtime/recovery-operations.js";

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

class StubRecoveryOperationExecutor
  implements RecoveryOperationExecutor {
  calls = 0;

  constructor(
    private readonly checkpoints:
      InMemoryCheckpointStore,
    private readonly controls:
      InMemoryRecoveryControlStore
  ) {}

  async execute(
    command: RecoveryOperationCommand
  ): Promise<RecoveryOperationResult> {
    this.calls += 1;

    const checkpoint =
      await this.checkpoints.load(
        command.runId
      );

    if (!checkpoint) {
      throw new Error(
        `Checkpoint not found: ${command.runId}`
      );
    }

    const control =
      await this.controls.load(
        command.runId
      ) ?? defaultControl(
        command.runId
      );

    if (
      command.requestedBy === "viewer"
    ) {
      return {
        status: "rejected",
        reason:
          "recovery_operation_denied",
        checkpoint,
        controlState: control
      };
    }

    return {
      status: "executed",
      reason: "recovery_completed",
      checkpoint,
      controlState: control
    };
  }
}

function defaultControl(
  runId: string
): RecoveryControlState {
  return {
    runId,
    version: 0,
    status: "active",
    updatedAt:
      "2026-10-07T04:00:00.000Z"
  };
}

function command(
  commandId: string,
  runId: string,
  checkpointVersion: number,
  requestedBy = "operator"
): DurableRecoveryOperationCommand {
  return {
    commandId,
    runId,
    operation: "retry_recovery",
    requestedBy,
    reason: "durable recovery request",
    expectedCheckpointVersion:
      checkpointVersion,
    expectedControlVersion: 0
  };
}

function recordFromCommand(
  input: DurableRecoveryOperationCommand,
  status:
    DurableRecoveryCommandRecord["status"]
): DurableRecoveryCommandRecord {
  return {
    commandId: input.commandId,
    runId: input.runId,
    operation: input.operation,
    requestedBy: input.requestedBy,
    reason: input.reason,
    expectedCheckpointVersion:
      input.expectedCheckpointVersion,
    expectedControlVersion:
      input.expectedControlVersion,
    status,
    version: 0,
    createdAt:
      "2026-10-07T04:00:00.000Z",
    updatedAt:
      "2026-10-07T04:00:00.000Z"
  };
}

const checkpoints =
  new InMemoryCheckpointStore();

const controls =
  new InMemoryRecoveryControlStore();

const commands =
  new InMemoryRecoveryCommandStore();

const executor =
  new StubRecoveryOperationExecutor(
    checkpoints,
    controls
  );

const orchestrator =
  new DurableRecoveryOperationOrchestrator(
    commands,
    executor,
    checkpoints,
    controls,
    {
      now: () =>
        "2026-10-07T04:00:00.000Z"
    }
  );

const successCheckpoint =
  await checkpoints.save(
    createInitialCheckpoint(
      "run-success"
    ),
    0
  );

const successCommand =
  command(
    "cmd-success",
    "run-success",
    successCheckpoint.version
  );

const first =
  await orchestrator.execute(
    successCommand
  );

assert(
  first.action === "executed_new",
  "new command should execute once"
);

assert(
  first.record.status === "succeeded",
  "successful operation should become terminal succeeded"
);

assert(
  first.resultSnapshot?.status ===
    "executed",
  "terminal command should persist replayable result snapshot"
);

assert(
  executor.calls === 1,
  "new command should invoke recovery executor once"
);

const replay =
  await orchestrator.execute(
    successCommand
  );

assert(
  replay.action ===
    "replayed_terminal",
  "same terminal command should replay stored result"
);

assert(
  replay.resultSnapshot?.reason ===
    first.resultSnapshot?.reason,
  "terminal replay should return stable snapshot"
);

assert(
  executor.calls === 1,
  "terminal replay must not execute recovery again"
);

let identityConflict = false;

try {
  await orchestrator.execute({
    ...successCommand,
    operation: "dead_letter"
  });
} catch (error) {
  identityConflict =
    error instanceof
      RecoveryCommandIdentityConflictError;
}

assert(
  identityConflict,
  "same commandId with different payload should be rejected"
);

const rejectedCheckpoint =
  await checkpoints.save(
    createInitialCheckpoint(
      "run-rejected"
    ),
    0
  );

const rejectedCommand =
  command(
    "cmd-rejected",
    "run-rejected",
    rejectedCheckpoint.version,
    "viewer"
  );

const rejected =
  await orchestrator.execute(
    rejectedCommand
  );

assert(
  rejected.action ===
    "executed_new" &&
  rejected.record.status ===
    "rejected",
  "rejected operation should become a durable terminal result"
);

const callsAfterRejected =
  executor.calls;

const rejectedReplay =
  await orchestrator.execute(
    rejectedCommand
  );

assert(
  rejectedReplay.action ===
    "replayed_terminal" &&
  rejectedReplay.resultSnapshot?.reason ===
    "recovery_operation_denied",
  "rejected terminal result should replay without re-execution"
);

assert(
  executor.calls ===
    callsAfterRejected,
  "rejected replay must not invoke executor"
);

const acceptedCheckpoint =
  await checkpoints.save(
    createInitialCheckpoint(
      "run-accepted"
    ),
    0
  );

const acceptedCommand =
  command(
    "cmd-accepted",
    "run-accepted",
    acceptedCheckpoint.version
  );

await commands.insertIfAbsent(
  recordFromCommand(
    acceptedCommand,
    "accepted"
  )
);

const callsBeforeAcceptedResume =
  executor.calls;

const acceptedResume =
  await orchestrator.execute(
    acceptedCommand
  );

assert(
  acceptedResume.action ===
    "resume_in_flight",
  "accepted command should enter in-flight recovery path"
);

assert(
  acceptedResume.facts
    .checkpointVersion ===
      acceptedCheckpoint.version,
  "in-flight path should reload current checkpoint facts"
);

assert(
  executor.calls ===
    callsBeforeAcceptedResume,
  "accepted command must not blindly rerun executor"
);

const executingCheckpoint =
  await checkpoints.save(
    createInitialCheckpoint(
      "run-executing"
    ),
    0
  );

const executingCommand =
  command(
    "cmd-executing",
    "run-executing",
    executingCheckpoint.version
  );

await commands.insertIfAbsent(
  recordFromCommand(
    executingCommand,
    "accepted"
  )
);

const executingRecord =
  await commands.load(
    executingCommand.commandId
  );

assert(
  executingRecord,
  "executing command seed should exist"
);

await commands.updateIfVersion(
  {
    ...executingRecord,
    status: "executing"
  },
  executingRecord.version
);

const callsBeforeExecutingResume =
  executor.calls;

const executingResume =
  await orchestrator.execute(
    executingCommand
  );

assert(
  executingResume.action ===
    "resume_in_flight",
  "executing command should inspect facts instead of replaying handler"
);

assert(
  executingResume.facts
    .controlStatus === "active",
  "in-flight inspection should include operational facts"
);

assert(
  executor.calls ===
    callsBeforeExecutingResume,
  "executing command must not blindly rerun executor"
);

console.log(
  "durable recovery operation orchestrator tests passed"
);
