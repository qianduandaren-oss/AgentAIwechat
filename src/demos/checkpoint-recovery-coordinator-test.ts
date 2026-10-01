import {
  createInitialCheckpoint,
  upsertToolExecution,
  type AgentRunCheckpoint,
  type ToolExecutionRecord
} from "../runtime/checkpoint.js";
import {
  InMemoryCheckpointStore,
  type CheckpointStore
} from "../runtime/checkpoint-store.js";
import { CheckpointRecoveryCoordinator } from "../runtime/checkpoint-recovery-coordinator.js";
import { ReconcilerRegistry } from "../runtime/reconciler.js";

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

class ConflictOnceStore
  implements CheckpointStore {

  private injected = false;

  constructor(
    private readonly base:
      InMemoryCheckpointStore
  ) {}

  load(
    runId: string
  ): Promise<AgentRunCheckpoint | undefined> {
    return this.base.load(runId);
  }

  async save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint> {
    if (!this.injected) {
      this.injected = true;

      const latest =
        await this.base.load(
          checkpoint.runId
        );

      if (!latest) {
        throw new Error(
          "missing checkpoint during conflict injection"
        );
      }

      const current =
        latest.toolExecutions[
          latest.toolExecutions.length - 1
        ];

      if (!current) {
        throw new Error(
          "missing tool record during conflict injection"
        );
      }

      const executed:
        ToolExecutionRecord = {
          ...current,
          outcome: "executed",
          finishedAt:
            new Date().toISOString()
        };

      const advanced =
        upsertToolExecution(
          {
            ...latest,
            boundary:
              "ready_for_next_step"
          },
          executed
        );

      await this.base.save(
        advanced,
        latest.version
      );
    }

    return this.base.save(
      checkpoint,
      expectedVersion
    );
  }
}

const base =
  new InMemoryCheckpointStore();

const initial =
  createInitialCheckpoint(
    "run-conflict-recovery"
  );

const v1 =
  await base.save(
    upsertToolExecution(
      {
        ...initial,
        step: 3,
        boundary: "reconciling_tool"
      },
      {
        toolCallId: "refund-call-1",
        toolName: "execute_refund",
        outcome: "started",
        idempotencyKey: "refund-001",
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

let reconcileCalls = 0;

registry.register(
  "execute_refund",
  {
    async reconcile() {
      reconcileCalls += 1;
      return "executed";
    }
  }
);

const coordinator =
  new CheckpointRecoveryCoordinator(
    new ConflictOnceStore(base),
    registry
  );

const result =
  await coordinator.recover(
    "run-conflict-recovery"
  );

assert(
  result.conflicts === 1,
  "coordinator should observe one CAS conflict"
);

assert(
  result.checkpoint.version === 2,
  "coordinator should reload the v2 checkpoint created by the other worker"
);

assert(
  result.checkpoint.boundary ===
    "ready_for_next_step",
  "reloaded checkpoint should preserve the other worker's boundary"
);

assert(
  result.checkpoint.toolExecutions[0]
    ?.outcome === "executed",
  "reloaded checkpoint should preserve executed outcome"
);

assert(
  reconcileCalls === 1,
  "reconciliation should not repeat after reload discovers executed outcome"
);

console.log(
  "checkpoint recovery coordinator test passed"
);
