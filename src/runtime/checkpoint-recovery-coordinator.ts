import { createId } from "../shared/utils.js";
import type {
  AgentRunCheckpoint
} from "./checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "./checkpoint-store.js";
import type {
  RecoveryEvent,
  RecoveryEventSink
} from "./recovery-observability.js";
import {
  prepareRecoveryTransition
} from "./recovery-preparation.js";
import { ReconcilerRegistry } from "./reconciler.js";
import type {
  RecoveryResolution
} from "./recovery-runtime.js";
import {
  CheckpointStoreRecoveryTransitionCommitter,
  type RecoveryTransitionCommitter
} from "./recovery-transition-committer.js";

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
  committer?: RecoveryTransitionCommitter;
}

export class CheckpointRecoveryCoordinator {
  private readonly maxConflicts: number;
  private readonly eventSink?: RecoveryEventSink;
  private readonly attemptIdFactory: () => string;
  private readonly now: () => string;
  private readonly committer:
    RecoveryTransitionCommitter;

  constructor(
    private readonly checkpointStore: CheckpointStore,
    private readonly reconcilerRegistry: ReconcilerRegistry,
    options: CheckpointRecoveryCoordinatorOptions = {}
  ) {
    this.maxConflicts = options.maxConflicts ?? 5;
    this.eventSink = options.eventSink;
    this.attemptIdFactory =
      options.attemptIdFactory ??
      (() => createId("recovery"));
    this.now =
      options.now ??
      (() => new Date().toISOString());
    this.committer =
      options.committer ??
      new CheckpointStoreRecoveryTransitionCommitter(
        checkpointStore
      );
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

  async recover(
    runId: string
  ): Promise<RecoveryCoordinatorResult> {
    let conflicts = 0;
    const recoveryAttemptId =
      this.attemptIdFactory();

    await this.record({
      type: "recovery_started",
      runId,
      recoveryAttemptId
    });

    while (true) {
      const checkpoint =
        await this.checkpointStore.load(runId);

      if (!checkpoint) {
        throw new Error(
          `Checkpoint not found: ${runId}`
        );
      }

      await this.record({
        type: "checkpoint_loaded",
        runId,
        recoveryAttemptId,
        checkpointVersion: checkpoint.version,
        boundary: checkpoint.boundary,
        conflictCount: conflicts
      });

      const prepared =
        await prepareRecoveryTransition(
          checkpoint,
          this.reconcilerRegistry,
          {
            now: this.now,
            hooks: {
              onPlanDecided:
                async (plan, record) => {
                  await this.record({
                    type: "plan_decided",
                    runId,
                    recoveryAttemptId,
                    checkpointVersion:
                      checkpoint.version,
                    toolCallId:
                      record.toolCallId,
                    toolName:
                      record.toolName,
                    action: plan.action,
                    reason: plan.reason,
                    conflictCount:
                      conflicts
                  });
                },
              onReconciliationStarted:
                async record => {
                  await this.record({
                    type:
                      "reconciliation_started",
                    runId,
                    recoveryAttemptId,
                    checkpointVersion:
                      checkpoint.version,
                    toolCallId:
                      record.toolCallId,
                    toolName:
                      record.toolName,
                    conflictCount:
                      conflicts
                  });
                },
              onReconciliationCompleted:
                async (outcome, record) => {
                  await this.record({
                    type:
                      "reconciliation_completed",
                    runId,
                    recoveryAttemptId,
                    checkpointVersion:
                      checkpoint.version,
                    toolCallId:
                      record.toolCallId,
                    toolName:
                      record.toolName,
                    reconciliationOutcome:
                      outcome,
                    conflictCount:
                      conflicts
                  });
                }
            }
          }
        );

      if (
        prepared.status === "completed" ||
        prepared.status ===
          "no_pending_tool"
      ) {
        await this.record({
          type: "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion:
            checkpoint.version,
          boundary:
            prepared.nextCheckpoint.boundary,
          reason:
            prepared.status === "completed"
              ? "checkpoint_already_completed"
              : "no_pending_tool_execution",
          conflictCount: conflicts
        });

        return {
          status: prepared.status,
          checkpoint:
            prepared.nextCheckpoint,
          conflicts,
          recoveryAttemptId
        };
      }

      const record = prepared.record;
      const resolution =
        prepared.resolution;

      if (!record || !resolution) {
        throw new Error(
          `Recovery preparation missing decision data for ${runId}`
        );
      }

      if (!prepared.shouldPersist) {
        await this.record({
          type:
            prepared.status === "suspended"
              ? "recovery_suspended"
              : "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion:
            checkpoint.version,
          boundary:
            prepared.nextCheckpoint.boundary,
          toolCallId:
            record.toolCallId,
          toolName:
            record.toolName,
          action:
            resolution.nextPlan?.action ??
            resolution.plan.action,
          reason:
            resolution.nextPlan?.reason ??
            resolution.plan.reason,
          conflictCount: conflicts
        });

        return {
          status: prepared.status,
          checkpoint:
            prepared.nextCheckpoint,
          conflicts,
          recoveryAttemptId,
          resolution
        };
      }

      try {
        const saved =
          await this.committer.commit(
            prepared
          );

        await this.record({
          type: "checkpoint_saved",
          runId,
          recoveryAttemptId,
          checkpointVersion:
            saved.version,
          boundary: saved.boundary,
          toolCallId:
            record.toolCallId,
          toolName:
            record.toolName,
          conflictCount: conflicts
        });

        await this.record({
          type:
            prepared.status === "suspended"
              ? "recovery_suspended"
              : "recovery_completed",
          runId,
          recoveryAttemptId,
          checkpointVersion:
            saved.version,
          boundary: saved.boundary,
          toolCallId:
            record.toolCallId,
          toolName:
            record.toolName,
          action:
            resolution.nextPlan?.action ??
            resolution.plan.action,
          reason:
            resolution.nextPlan?.reason ??
            resolution.plan.reason,
          conflictCount: conflicts
        });

        return {
          status: prepared.status,
          checkpoint: saved,
          conflicts,
          recoveryAttemptId,
          resolution
        };
      } catch (error) {
        if (
          !(
            error instanceof
            CheckpointConflictError
          )
        ) {
          throw error;
        }

        conflicts += 1;

        await this.record({
          type: "checkpoint_conflict",
          runId,
          recoveryAttemptId,
          checkpointVersion:
            checkpoint.version,
          boundary:
            checkpoint.boundary,
          toolCallId:
            record.toolCallId,
          toolName:
            record.toolName,
          reason: error.message,
          conflictCount: conflicts
        });

        if (
          conflicts >
          this.maxConflicts
        ) {
          throw new Error(
            `Checkpoint recovery exceeded max conflicts for ${runId}: ${this.maxConflicts}`
          );
        }
      }
    }
  }
}
