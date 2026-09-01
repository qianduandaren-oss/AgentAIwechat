import type { LLMProvider } from "../llm/types.js";
import { selectAgent } from "../multi-agent/agent-router.js";
import type {
  RoutingEvalCase,
  RoutingEvalFailureKind,
  RoutingEvalResult,
  RoutingEvalSummary
} from "./types.js";

export async function evaluateRoutingCase(
  provider: LLMProvider,
  evalCase: RoutingEvalCase
): Promise<RoutingEvalResult> {
  try {
    const selection = await selectAgent(provider, evalCase.goal);
    const passed = selection.agentId === evalCase.expectedAgentId;

    return {
      caseId: evalCase.id,
      goal: evalCase.goal,
      expectedAgentId: evalCase.expectedAgentId,
      actualAgentId: selection.agentId,
      passed,
      reason: passed
        ? `expected=${evalCase.expectedAgentId}, actual=${selection.agentId}`
        : `routing mismatch: expected=${evalCase.expectedAgentId}, actual=${selection.agentId}`,
      failureKind: passed ? undefined : "routing_error",
      tags: evalCase.tags
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      goal: evalCase.goal,
      expectedAgentId: evalCase.expectedAgentId,
      actualAgentId: "<error>",
      passed: false,
      reason: error instanceof Error ? error.message : String(error),
      failureKind: "execution_error",
      tags: evalCase.tags
    };
  }
}

export async function runRoutingEvaluation(
  provider: LLMProvider,
  cases: RoutingEvalCase[]
): Promise<RoutingEvalSummary> {
  const results: RoutingEvalResult[] = [];

  for (const evalCase of cases) {
    results.push(await evaluateRoutingCase(provider, evalCase));
  }

  const passed = results.filter(result => result.passed).length;
  const total = results.length;
  const failed = total - passed;
  const failuresByKind: Record<RoutingEvalFailureKind, number> = {
    routing_error: 0,
    execution_error: 0,
    evaluation_data_error: 0
  };

  for (const result of results) {
    if (!result.passed && result.failureKind) {
      failuresByKind[result.failureKind] += 1;
    }
  }

  return {
    total,
    passed,
    failed,
    accuracy: total === 0 ? 0 : passed / total,
    failuresByKind,
    results
  };
}
