import type {
  AgentRunCheckpoint
} from "../runtime/checkpoint.js";
import {
  prepareRecoveryTransition
} from "../runtime/recovery-preparation.js";
import {
  ReconcilerRegistry
} from "../runtime/reconciler.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

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

const checkpoint: AgentRunCheckpoint = {
  runId: "run-day46-preparation",
  version: 7,
  step: 3,
  boundary: "reconciling_tool",
  toolExecutions: [
    {
      toolCallId: "tool-call-1",
      toolName: "send_message",
      outcome: "started",
      idempotencyKey: "message-001",
      sideEffect: "external_side_effect",
      retrySafe: false
    }
  ],
  updatedAt: "2026-10-06T00:00:00.000Z"
};

const prepared =
  await prepareRecoveryTransition(
    checkpoint,
    registry,
    {
      now: () =>
        "2026-10-06T00:01:00.000Z"
    }
  );

assert(
  checkpoint.version === 7,
  "prepare must not mutate checkpoint version"
);

assert(
  checkpoint.boundary ===
    "reconciling_tool",
  "prepare must not mutate current checkpoint"
);

assert(
  prepared.expectedCheckpointVersion === 7,
  "prepare must carry the observed version"
);

assert(
  prepared.status === "advanced",
  "executed reconciliation should advance"
);

assert(
  prepared.shouldPersist,
  "advanced transition should require commit"
);

assert(
  prepared.nextCheckpoint.version === 7,
  "prepare must not allocate the persisted version"
);

assert(
  prepared.nextCheckpoint.boundary ===
    "ready_for_next_step",
  "next checkpoint should be ready for next step"
);

assert(
  prepared.nextCheckpoint
    .toolExecutions[0]
    ?.outcome === "executed",
  "prepared transition should carry reconciled outcome"
);

const completed =
  await prepareRecoveryTransition(
    {
      ...checkpoint,
      boundary: "completed"
    },
    registry
  );

assert(
  completed.status === "completed",
  "completed checkpoint should be a no-op"
);

assert(
  !completed.shouldPersist,
  "completed checkpoint should not create another write"
);

console.log(
  "recovery preparation tests passed"
);
