import type { AgentToolCall } from "../llm/types.js";
import {
  getToolEffectPolicy,
  type ToolEffectPolicy
} from "../security/tool-effect-policy.js";
import {
  SecureToolExecutor,
  type SecureToolExecutionResult
} from "../security/secure-tool-executor.js";
import { createIdempotencyKey } from "../security/idempotency.js";
import {
  createInitialCheckpoint,
  type AgentRunCheckpoint,
  type ToolExecutionRecord,
  upsertToolExecution
} from "./checkpoint.js";
import type { CheckpointStore } from "./checkpoint-store.js";

export interface DurableToolExecuteOptions {
  runId: string;
  step: number;
  approvedActionId?: string;
  signal?: AbortSignal;
  checkpoint?: AgentRunCheckpoint;
}

export interface DurableToolExecutionResult {
  execution: SecureToolExecutionResult;
  checkpoint: AgentRunCheckpoint;
  record: ToolExecutionRecord;
}

export type ToolEffectPolicyResolver = (
  toolName: string
) => ToolEffectPolicy;

function isUncertainExternalFailure(
  error: unknown,
  policy: ToolEffectPolicy
): boolean {
  if (policy.sideEffect !== "external_side_effect") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /(timeout|network|connection|socket|ECONN|abort|cancel)/i.test(message);
}

export class DurableToolExecutor {
  constructor(
    private readonly secureExecutor: SecureToolExecutor,
    private readonly checkpointStore: CheckpointStore,
    private readonly policyResolver: ToolEffectPolicyResolver = getToolEffectPolicy
  ) {}

  async execute(
    toolCall: AgentToolCall,
    options: DurableToolExecuteOptions
  ): Promise<DurableToolExecutionResult> {
    let checkpoint =
      options.checkpoint ??
      (await this.checkpointStore.load(options.runId)) ??
      createInitialCheckpoint(options.runId);

    const policy = this.policyResolver(toolCall.name);
    const record: ToolExecutionRecord = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      outcome: "started",
      idempotencyKey: createIdempotencyKey(
        toolCall,
        options.approvedActionId
      ),
      sideEffect: policy.sideEffect,
      retrySafe: policy.retrySafe,
      startedAt: new Date().toISOString()
    };

    const intentCheckpoint = upsertToolExecution(
      {
        ...checkpoint,
        step: options.step,
        boundary: "ready_for_tool"
      },
      record
    );

    checkpoint = await this.checkpointStore.save(
      intentCheckpoint,
      checkpoint.version
    );

    try {
      const execution = await this.secureExecutor.execute(
        toolCall,
        options.approvedActionId,
        { signal: options.signal }
      );

      if (execution.status === "executed") {
        const executedRecord: ToolExecutionRecord = {
          ...record,
          outcome: "executed",
          idempotencyKey: execution.idempotencyKey,
          finishedAt: new Date().toISOString()
        };
        const next = upsertToolExecution(
          {
            ...checkpoint,
            boundary: "ready_for_next_step"
          },
          executedRecord
        );
        checkpoint = await this.checkpointStore.save(
          next,
          checkpoint.version
        );
        return { execution, checkpoint, record: executedRecord };
      }

      if (execution.status === "pending_approval") {
        const waitingRecord: ToolExecutionRecord = {
          ...record,
          outcome: "never_executed"
        };
        const waiting = upsertToolExecution(
          {
            ...checkpoint,
            boundary: "waiting_approval"
          },
          waitingRecord
        );
        checkpoint = await this.checkpointStore.save(
          waiting,
          checkpoint.version
        );
        return { execution, checkpoint, record: waitingRecord };
      }

      const deniedRecord: ToolExecutionRecord = {
        ...record,
        outcome: "cancelled_before_execution",
        finishedAt: new Date().toISOString(),
        error: execution.reason
      };
      const denied = upsertToolExecution(
        {
          ...checkpoint,
          boundary: "ready_for_next_step"
        },
        deniedRecord
      );
      checkpoint = await this.checkpointStore.save(
        denied,
        checkpoint.version
      );
      return { execution, checkpoint, record: deniedRecord };
    } catch (error) {
      const failedRecord: ToolExecutionRecord = {
        ...record,
        outcome: isUncertainExternalFailure(error, policy)
          ? "unknown"
          : "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };

      const failed = upsertToolExecution(
        {
          ...checkpoint,
          boundary:
            failedRecord.outcome === "unknown"
              ? "reconciling_tool"
              : "ready_for_next_step"
        },
        failedRecord
      );

      await this.checkpointStore.save(
        failed,
        checkpoint.version
      );

      throw error;
    }
  }
}
