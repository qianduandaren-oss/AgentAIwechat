import { createId } from "../shared/utils.js";
import {
  type AgentRunCheckpoint,
  type ToolExecutionRecord,
  upsertToolExecution
} from "./checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "./checkpoint-store.js";
import type {
  RecoveryEvent,
  RecoveryEventSink
} from "./recovery-observability.js";
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
  recoveryAttemptId?: string;
  resolution?: RecoveryResolution;
}

export interface CheckpointRecoveryCoordinatorOptions {
  maxConflicts?: number;
  eventSink?: RecoveryEventSink;
  attemptIdFactory?: () => string;
  now?: () => string;
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
        { ...checkpoint, boundary: "ready_for_next_step" },
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
        { ...checkpoint, boundary: "ready_for_tool" },
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
        { ...checkpoint, boundary: "reconciling_tool" },
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
  private readonly eventSink?: RecoveryEventSink;
  private readonly attemptIdFactory: () => string;
  private readonly now: () => string;

  constructor(
    private readonly checkpointStore: CheckpointStore,
    private readonly reconcilerRegistry: ReconcilerRegistry,
    options: CheckpointRecoveryCoordinatorOptions = {}
  ) {
    this.maxConflicts = options.maxConflicts ?? 5;
    this.eventSink = options.eventSink;
    this.attemptIdFactory =
      options.attemptIdFactory ?? (() => createId("recovery"));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async record(
    event: Omit<RecoveryEvent, "timestamp">
  ): Promise<void> {
    if (!this.eventSink) return;

    try {
      await this.eventSink.record({
        ...event,
        timestamp: this.now()
      });
    } catch {
      // Recovery observability is best-effort.
    }
  }

  async recover(runId: string): Promise<RecoveryCoordinatorResult> {
    let conflicts = 0;
    const recoveryAttemptId = this.attemptIdFactory();

    await this.record({
      type: "recovery_started",
      runId,
      recoveryAttemptId
    });

    while (true) {
      const checkpoint = await this.checkpointStore.load(runId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${runId}`);
      }

      await this.record({
        type: "checkpoint_loaded",
        runId,
        recoveryAttemptId,
        checkpointVersion: checkpoint.version,
        boundary: checkpoint.boundary,
        conflictCount: conflicts
      });

      if (checkpoint.boundary === "completed") {
        await this.record({
          type: "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion: checkpoint.version,
          boundary: checkpoint.boundary,
          reason: "checkpoint_already_completed",
          conflictCount: conflicts
        });

        return {
          status: "completed",
          checkpoint,
          conflicts,
          recoveryAttemptId
        };
      }

      const record = findRecoveryRecord(checkpoint);
      if (!record) {
        await this.record({
          type: "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion: checkpoint.version,
          boundary: checkpoint.boundary,
          reason: "no_pending_tool_execution",
          conflictCount: conflicts
        });

        return {
          status: "no_pending_tool",
          checkpoint,
          conflicts,
          recoveryAttemptId
        };
      }

      const resolution = await recoverToolExecution(
        record,
        this.reconcilerRegistry,
        undefined,
        {
          onPlanDecided: async plan => {
            await this.record({
              type: "plan_decided",
              runId,
              recoveryAttemptId,
              checkpointVersion: checkpoint.version,
              toolCallId: record.toolCallId,
              toolName: record.toolName,
              action: plan.action,
              reason: plan.reason,
              conflictCount: conflicts
            });
          },
          onReconciliationStarted: async () => {
            await this.record({
              type: "reconciliation_started",
              runId,
              recoveryAttemptId,
              checkpointVersion: checkpoint.version,
              toolCallId: record.toolCallId,
              toolName: record.toolName,
              conflictCount: conflicts
            });
          },
          onReconciliationCompleted: async outcome => {
            await this.record({
              type: "reconciliation_completed",
              runId,
              recoveryAttemptId,
              checkpointVersion: checkpoint.version,
              toolCallId: record.toolCallId,
              toolName: record.toolName,
              reconciliationOutcome: outcome,
              conflictCount: conflicts
            });
          }
        }
      );

      const applied = applyResolution(checkpoint, record, resolution);

      if (!applied.shouldPersist) {
        await this.record({
          type:
            applied.status === "suspended"
              ? "recovery_suspended"
              : "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion: checkpoint.version,
          boundary: applied.checkpoint.boundary,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          action: resolution.nextPlan?.action ?? resolution.plan.action,
          reason: resolution.nextPlan?.reason ?? resolution.plan.reason,
          conflictCount: conflicts
        });

        return {
          status: applied.status,
          checkpoint: applied.checkpoint,
          conflicts,
          recoveryAttemptId,
          resolution
        };
      }

      try {
        const saved = await this.checkpointStore.save(
          applied.checkpoint,
          checkpoint.version
        );

        await this.record({
          type: "checkpoint_saved",
          runId,
          recoveryAttemptId,
          checkpointVersion: saved.version,
          boundary: saved.boundary,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          conflictCount: conflicts
        });

        await this.record({
          type:
            applied.status === "suspended"
              ? "recovery_suspended"
              : "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion: saved.version,
          boundary: saved.boundary,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          action: resolution.nextPlan?.action ?? resolution.plan.action,
          reason: resolution.nextPlan?.reason ?? resolution.plan.reason,
          conflictCount: conflicts
        });

        return {
          status: applied.status,
          checkpoint: saved,
          conflicts,
          recoveryAttemptId,
          resolution
        };
      } catch (error) {
        if (!(error instanceof CheckpointConflictError)) {
          throw error;
        }

        conflicts += 1;

        await this.record({
          type: "checkpoint_conflict",
          runId,
          recoveryAttemptId,
          checkpointVersion: checkpoint.version,
          boundary: checkpoint.boundary,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          reason: error.message,
          conflictCount: conflicts
        });

        if (conflicts > this.maxConflicts) {
          throw new Error(
            `Checkpoint recovery exceeded max conflicts for ${runId}: ${this.maxConflicts}`
          );
        }
      }
    }
  }
}
