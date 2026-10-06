import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import {
  InMemoryCheckpointStore
} from "../runtime/checkpoint-store.js";
import {
  CheckpointRecoveryCoordinator
} from "../runtime/checkpoint-recovery-coordinator.js";
import {
  ReconcilerRegistry
} from "../runtime/reconciler.js";
import type {
  PreparedRecoveryTransition
} from "../runtime/recovery-preparation.js";
import {
  CheckpointStoreRecoveryTransitionCommitter,
  type RecoveryTransitionCommitter
} from "../runtime/recovery-transition-committer.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

class RecordingCommitter
  implements RecoveryTransitionCommitter {

  calls = 0;
  expectedVersion?: number;
  candidateVersion?: number;

  constructor(
    private readonly inner:
      RecoveryTransitionCommitter
  ) {}

  async commit(
    prepared: PreparedRecoveryTransition
  ) {
    this.calls += 1;
    this.expectedVersion =
      prepared.expectedCheckpointVersion;
    this.candidateVersion =
      prepared.nextCheckpoint.version;

    return this.inner.commit(prepared);
  }
}

const store =
  new InMemoryCheckpointStore();

const initial =
  createInitialCheckpoint(
    "run-day46-committer"
  );

const v1 =
  await store.save(
    upsertToolExecution(
      {
        ...initial,
        step: 4,
        boundary:
          "reconciling_tool"
      },
      {
        toolCallId:
          "message-call-1",
        toolName:
          "send_message",
        outcome: "started",
        idempotencyKey:
          "message-day46-001",
        sideEffect:
          "external_side_effect",
        retrySafe: false
      }
    ),
    0
  );

assert(
  v1.version === 1,
  "initial checkpoint should be v1"
);

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

const recordingCommitter =
  new RecordingCommitter(
    new CheckpointStoreRecoveryTransitionCommitter(
      store
    )
  );

const coordinator =
  new CheckpointRecoveryCoordinator(
    store,
    registry,
    {
      committer:
        recordingCommitter,
      attemptIdFactory:
        () =>
          "recovery-day46-noon"
    }
  );

const result =
  await coordinator.recover(
    "run-day46-committer"
  );

assert(
  recordingCommitter.calls === 1,
  "coordinator should commit exactly once"
);

assert(
  recordingCommitter.expectedVersion === 1,
  "committer should receive the observed checkpoint version"
);

assert(
  recordingCommitter.candidateVersion === 1,
  "prepare must not allocate the persisted version"
);

assert(
  result.checkpoint.version === 2,
  "commit should allocate v2"
);

assert(
  result.checkpoint.boundary ===
    "ready_for_next_step",
  "committed checkpoint should advance"
);

assert(
  result.checkpoint
    .toolExecutions[0]
    ?.outcome === "executed",
  "committed checkpoint should keep reconciled outcome"
);

const stored =
  await store.load(
    "run-day46-committer"
  );

assert(
  stored?.version === 2,
  "checkpoint store should persist committed version"
);

console.log(
  "recovery transition committer tests passed"
);
