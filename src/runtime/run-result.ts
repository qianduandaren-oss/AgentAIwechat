import type { AgentLoopResult } from "../agent/agent-loop.js";

export type AgentStopReason =
  | "completed"
  | "budget_warning"
  | "budget_exceeded"
  | "permission_denied"
  | "deadline_exceeded"
  | "max_steps_reached"
  | "runtime_error";

export type AgentRunStatus = "completed" | "stopped" | "failed";

export interface AgentRunSuccess {
  status: "completed";
  stopReason: "completed";
  result: AgentLoopResult;
}

export interface AgentRunStopped {
  status: "stopped" | "failed";
  stopReason: Exclude<AgentStopReason, "completed">;
  message: string;
  cause?: unknown;
}

export type AgentRunResult = AgentRunSuccess | AgentRunStopped;

export function isAgentRunSuccess(result: AgentRunResult): result is AgentRunSuccess {
  return result.status === "completed";
}
