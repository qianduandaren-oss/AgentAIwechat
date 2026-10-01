import {
  type AgentRunCheckpoint,
  type ToolExecutionRecord,
  upsertToolExecution
} from "./checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "./checkpoint-store.js";
import { ReconcilerRegistry } from "./reconciler.js";
import {
  recoverToolExecution,
  type RecoveryResolution
} from "./recovery-runtime.js";

export type RecoveryCoordinatorStatus =
  | "completed"
  | "advanced"
  | "retry_required"
  | "suspended"
  | "no_pending_tool";

export interface RecoveryCoordinatorResult {
  status: RecoveryCoordinatorStatus;
  checkpoint: AgentRunCheckpoint;
  conflicts: number;
  resolution?: RecoveryResolution;
}

export interface CheckpointRecoveryCoordinatorOptions {
  maxConflicts?: number;
}

function findRecoveryRecord(
  checkpoint: AgentRunCheckpoint
): ToolExecutionRecord | undefined {
  return [...checkpoint.toolExecutions]
    .reverse()
    .find(record =>
      record.outcome === "started" ||
      record.outcome === "unknown" ||
      record.outcome === "failed" ||
      record.outcome === "never_executed" ||
      record.outcome === "executed"
    );
}

function applyResolution(
  checkpoint: AgentRunCheckpoint,
  record: ToolExecutionRecord,
  resolution: RecoveryResolution
): {
  checkpoint: AgentRunCheckpoint;
  status: RecoveryCoordinatorStatus;
  shouldPersist: boolean;
} {
  const action = resolution.nextPlan?.action ?? resolution.plan.action;

  if (resolution.resolvedOutcome === "executed" || action === "skip") {
    const executed: ToolExecutionRecord = {
      ...record,
      outcome: "executed",
      finishedAt: record.finishedAt ?? new Date().toISOString()
    };

    return {
      checkpoint: upsertToolExecution(
        {
          ...checkpoint,
          boundary: "ready_for_next_step"
        },
        executed
      ),
      status: "advanced",
      shouldPersist:
        record.outcome !== "executed" ||
        checkpoint.boundary !== "ready_for_next_step"
    };
  }

  if (resolution.resolvedOutcome === "never_executed" || action === "retry") {
    const retryable: ToolExecutionRecord = {
      ...record,
      outcome: "never_executed"
    };

    return {
      checkpoint: upsertToolExecution(
        {
          ...checkpoint,
          boundary: "ready_for_tool"
        },
        retryable
      ),
      status: "retry_required",
      shouldPersist:
        record.outcome !== "never_executed" ||
        checkpoint.boundary !== "ready_for_tool"
    };
  }

  if (resolution.resolvedOutcome === "unknown" || action === "suspend") {
    const suspended: ToolExecutionRecord = {
      ...record,
      outcome: resolution.resolvedOutcome ?? record.outcome
    };

    return {
      checkpoint: upsertToolExecution(
        {
          ...checkpoint,
          boundary: "reconciling_tool"
        },
        suspended
      ),
      status: "suspended",
      shouldPersist:
        suspended.outcome !== record.outcome ||
        checkpoint.boundary !== "reconciling_tool"
    };
  }

  return {
    checkpoint,
    status: "suspended",
    shouldPersist: false
  };
}

export class CheckpointRecoveryCoordinator {
  private readonly maxConflicts: number;

  constructor(
    private readonly checkpointStore: CheckpointStore,
    private readonly reconcilerRegistry: ReconcilerRegistry,
    options: CheckpointRecoveryCoordinatorOptions = {}
  ) {
    this.maxConflicts = options.maxConflicts ?? 5;
  }

  async recover(runId: string): Promise<RecoveryCoordinatorResult> {
    let conflicts = 0;

    while (true) {
      const checkpoint = await this.checkpointStore.load(runId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${runId}`);
      }

      if (checkpoint.boundary === "completed") {
        return {
          status: "completed",
          checkpoint,
          conflicts
        };
      }

      const record = findRecoveryRecord(checkpoint);
      if (!record) {
        return {
          status: "no_pending_tool",
          checkpoint,
          conflicts
        };
      }

      const resolution = await recoverToolExecution(
        record,
        this.reconcilerRegistry
      );

      const applied = applyResolution(
        checkpoint,
        record,
        resolution
      );

      if (!applied.shouldPersist) {
        return {
          status: applied.status,
          checkpoint: applied.checkpoint,
          conflicts,
          resolution
        };
      }

      try {
        const saved = await this.checkpointStore.save(
          applied.checkpoint,
          checkpoint.version
        );

        return {
          status: applied.status,
          checkpoint: saved,
          conflicts,
          resolution
        };
      } catch (error) {
        if (!(error instanceof CheckpointConflictError)) {
          throw error;
        }

        conflicts += 1;
        if (conflicts > this.maxConflicts) {
          throw new Error(
            `Checkpoint recovery exceeded max conflicts for ${runId}: ${this.maxConflicts}`
          );
        }

        // Important: never retry the stale write. Loop back to load the
        // latest checkpoint, then re-run recovery planning from new facts.
      }
    }
  }
}
