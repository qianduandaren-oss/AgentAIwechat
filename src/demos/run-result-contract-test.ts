import { toAgentHttpStatus } from "../runtime/http-adapter.js";
import { AgentRunBudgetExceededError } from "../runtime/run-budget.js";
import { TimeoutError } from "../runtime/resilience.js";
import { toAgentRunResult, type AgentRunResult } from "../runtime/run-result.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Contract check failed: ${message}`);
}

function assertStopped(
  result: AgentRunResult,
  stopReason: Exclude<AgentRunResult["stopReason"], "completed">,
  statusCode: number
) {
  assert(result.status !== "completed", `expected stopped result for ${stopReason}`);
  assert(result.stopReason === stopReason, `expected ${stopReason}, got ${result.stopReason}`);
  assert(toAgentHttpStatus(result) === statusCode, `expected HTTP ${statusCode} for ${stopReason}`);
}

assertStopped(toAgentRunResult(new AgentRunBudgetExceededError("steps", 9, 8)), "max_steps_reached", 200);
assertStopped(toAgentRunResult(new AgentRunBudgetExceededError("model_calls", 13, 12)), "budget_exceeded", 200);
assertStopped(toAgentRunResult(new TimeoutError("LLM timed out")), "deadline_exceeded", 504);
assertStopped(toAgentRunResult(new Error("permission denied for tool")), "permission_denied", 403);
assertStopped(toAgentRunResult(new Error("unexpected parser failure")), "runtime_error", 500);

console.log("Runtime contract checks passed");
