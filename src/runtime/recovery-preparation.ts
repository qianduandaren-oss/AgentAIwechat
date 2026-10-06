import type {
  AgentRunCheckpoint,
  ToolExecutionRecord
} from "./checkpoint.js";
import { upsertToolExecution } from "./checkpoint.js";
import { ReconcilerRegistry } from "./reconciler.js";
import {
  recoverToolExecution,
  type RecoveryPolicyResolver,
  type RecoveryResolution,
  type RecoveryRuntimeHooks
} from "./recovery-runtime.js";

export type RecoveryPreparationStatus =
  | "completed"
  | "advanced"
  | "retry_required"
  | "suspended"
  | "no_pending_tool";

export interface PreparedRecoveryTransition {
  status: RecoveryPreparationStatus;
  expectedCheckpointVersion: number;
  currentCheckpoint: AgentRunCheckpoint;
  nextCheckpoint: AgentRunCheckpoint;
  shouldPersist: boolean;
  record?: ToolExecutionRecord;
  resolution?: RecoveryResolution;
}

export interface RecoveryPreparationOptions {
  policyResolver?: RecoveryPolicyResolver;
  hooks?: RecoveryRuntimeHooks;
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

function stamp(
  checkpoint: AgentRunCheckpoint,
  now: () => string
): AgentRunCheckpoint {
  return {
    ...checkpoint,
    updatedAt: now()
  };
}

function applyResolution(
  checkpoint: AgentRunCheckpoint,
  record: ToolExecutionRecord,
  resolution: RecoveryResolution,
  now: () => string
) {
  const action =
    resolution.nextPlan?.action ??
    resolution.plan.action;

  if (
    resolution.resolvedOutcome === "executed" ||
    action === "skip"
  ) {
    const executed: ToolExecutionRecord = {
      ...record,
      outcome: "executed",
      finishedAt: record.finishedAt ?? now()
    };

    return {
      checkpoint: stamp(
        upsertToolExecution(
          {
            ...checkpoint,
            boundary: "ready_for_next_step"
          },
          executed
        ),
        now
      ),
      status: "advanced" as const,
      shouldPersist:
        record.outcome !== "executed" ||
        checkpoint.boundary !==
          "ready_for_next_step"
    };
  }

  if (
    resolution.resolvedOutcome ===
      "never_executed" ||
    action === "retry"
  ) {
    const retryable: ToolExecutionRecord = {
      ...record,
      outcome: "never_executed"
    };

    return {
      checkpoint: stamp(
        upsertToolExecution(
          {
            ...checkpoint,
            boundary: "ready_for_tool"
          },
          retryable
        ),
        now
      ),
      status: "retry_required" as const,
      shouldPersist:
        record.outcome !== "never_executed" ||
        checkpoint.boundary !==
          "ready_for_tool"
    };
  }

  if (
    resolution.resolvedOutcome === "unknown" ||
    action === "suspend"
  ) {
    const suspended: ToolExecutionRecord = {
      ...record,
      outcome:
        resolution.resolvedOutcome ??
        record.outcome
    };

    return {
      checkpoint: stamp(
        upsertToolExecution(
          {
            ...checkpoint,
            boundary: "reconciling_tool"
          },
          suspended
        ),
        now
      ),
      status: "suspended" as const,
      shouldPersist:
        suspended.outcome !== record.outcome ||
        checkpoint.boundary !==
          "reconciling_tool"
    };
  }

  return {
    checkpoint:
      structuredClone(checkpoint),
    status: "suspended" as const,
    shouldPersist: false
  };
}

export async function prepareRecoveryTransition(
  checkpoint: AgentRunCheckpoint,
  registry: ReconcilerRegistry,
  options: RecoveryPreparationOptions = {}
): Promise<PreparedRecoveryTransition> {
  const now =
    options.now ??
    (() => new Date().toISOString());

  const currentCheckpoint =
    structuredClone(checkpoint);

  if (checkpoint.boundary === "completed") {
    return {
      status: "completed",
      expectedCheckpointVersion:
        checkpoint.version,
      currentCheckpoint,
      nextCheckpoint:
        structuredClone(checkpoint),
      shouldPersist: false
    };
  }

  const record =
    findRecoveryRecord(checkpoint);

  if (!record) {
    return {
      status: "no_pending_tool",
      expectedCheckpointVersion:
        checkpoint.version,
      currentCheckpoint,
      nextCheckpoint:
        structuredClone(checkpoint),
      shouldPersist: false
    };
  }

  const resolution =
    await recoverToolExecution(
      record,
      registry,
      options.policyResolver,
      options.hooks
    );

  const applied =
    applyResolution(
      checkpoint,
      record,
      resolution,
      now
    );

  return {
    status: applied.status,
    expectedCheckpointVersion:
      checkpoint.version,
    currentCheckpoint,
    nextCheckpoint:
      applied.checkpoint,
    shouldPersist:
      applied.shouldPersist,
    record:
      structuredClone(record),
    resolution
  };
}
