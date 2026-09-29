import type { ToolSideEffect } from "../security/tool-effect-policy.js";

export type ToolExecutionOutcome =
  | "never_executed"
  | "started"
  | "executed"
  | "failed"
  | "unknown"
  | "cancelled_before_execution";

export type ResumeBoundary =
  | "ready_for_llm"
  | "ready_for_tool"
  | "waiting_approval"
  | "reconciling_tool"
  | "ready_for_next_step"
  | "completed";

export interface ToolExecutionRecord {
  toolCallId: string;
  toolName: string;
  outcome: ToolExecutionOutcome;
  idempotencyKey?: string;
  sideEffect?: ToolSideEffect;
  retrySafe?: boolean;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface AgentRunCheckpoint {
  runId: string;
  version: number;
  step: number;
  boundary: ResumeBoundary;
  toolExecutions: ToolExecutionRecord[];
  updatedAt: string;
}

export function createInitialCheckpoint(runId: string): AgentRunCheckpoint {
  return {
    runId,
    version: 0,
    step: 0,
    boundary: "ready_for_llm",
    toolExecutions: [],
    updatedAt: new Date().toISOString()
  };
}

export function upsertToolExecution(
  checkpoint: AgentRunCheckpoint,
  record: ToolExecutionRecord
): AgentRunCheckpoint {
  const existingIndex = checkpoint.toolExecutions.findIndex(
    item => item.toolCallId === record.toolCallId
  );
  const toolExecutions = checkpoint.toolExecutions.map(item => ({ ...item }));
  if (existingIndex >= 0) {
    toolExecutions[existingIndex] = { ...record };
  } else {
    toolExecutions.push({ ...record });
  }
  return {
    ...checkpoint,
    toolExecutions,
    updatedAt: new Date().toISOString()
  };
}
