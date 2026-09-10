import { evaluateBudgetPolicy } from "../runtime/budget-policy.js";
import type { AgentRunBudgetLimit, AgentRunBudgetSnapshot } from "../runtime/run-budget.js";

const limit: AgentRunBudgetLimit = { maxSteps: 10, maxModelCalls: 10, maxTokens: 10000, maxCostUsd: 1 };

function makeSnapshot(steps: number, modelCalls: number, totalTokens: number, costUsd: number): AgentRunBudgetSnapshot {
  return {
    steps,
    modelCalls,
    tokenBudget: {
      usage: { inputTokens: totalTokens, outputTokens: 0, totalTokens },
      costUsd,
      remainingTokens: Math.max(0, limit.maxTokens - totalTokens),
      remainingCostUsd: Math.max(0, limit.maxCostUsd - costUsd)
    }
  };
}

for (const value of [
  makeSnapshot(3, 3, 3000, 0.3),
  makeSnapshot(8, 6, 7000, 0.6),
  makeSnapshot(10, 8, 8000, 0.8)
]) {
  console.log(evaluateBudgetPolicy(value, limit));
}
