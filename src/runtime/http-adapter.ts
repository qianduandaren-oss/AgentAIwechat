import type { AgentRunResult } from "./run-result.js";
import type { ProductionAgentRuntime, ProductionRunOptions } from "./production-runtime.js";

export interface AgentHttpResponse {
  statusCode: number;
  body: AgentRunResult;
}

export function toAgentHttpStatus(result: AgentRunResult): number {
  switch (result.stopReason) {
    case "completed":
      return 200;
    case "permission_denied":
      return 403;
    case "deadline_exceeded":
      return 504;
    case "runtime_error":
      return 500;
    case "budget_warning":
    case "budget_exceeded":
    case "max_steps_reached":
      return 200;
  }
}

export async function handleAgentRun(
  runtime: ProductionAgentRuntime,
  userMessage: string,
  runOptions: ProductionRunOptions = {}
): Promise<AgentHttpResponse> {
  const body = await runtime.runStructured(userMessage, runOptions);
  return {
    statusCode: toAgentHttpStatus(body),
    body
  };
}
