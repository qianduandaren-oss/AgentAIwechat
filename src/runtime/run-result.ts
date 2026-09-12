import type { AgentLoopResult } from "../agent/agent-loop.js";
import { AgentRunBudgetExceededError } from "./run-budget.js";
import { TimeoutError } from "./resilience.js";

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

export function toAgentRunResult(error: unknown): AgentRunStopped {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof AgentRunBudgetExceededError) {
    return {
      status: "stopped",
      stopReason: error.kind === "steps" ? "max_steps_reached" : "budget_exceeded",
      message,
      cause: error
    };
  }

  if (error instanceof TimeoutError) {
    return {
      status: "stopped",
      stopReason: "deadline_exceeded",
      message,
      cause: error
    };
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("budget") && (normalized.includes("exceed") || normalized.includes("exhaust"))) {
    return { status: "stopped", stopReason: "budget_exceeded", message, cause: error };
  }

  if (normalized.includes("permission") || normalized.includes("authorization") || normalized.includes("denied")) {
    return { status: "stopped", stopReason: "permission_denied", message, cause: error };
  }

  if (normalized.includes("maxsteps") || normalized.includes("max steps")) {
    return { status: "stopped", stopReason: "max_steps_reached", message, cause: error };
  }

  return {
    status: "failed",
    stopReason: "runtime_error",
    message,
    cause: error
  };
}
