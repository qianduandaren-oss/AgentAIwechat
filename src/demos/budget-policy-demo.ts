import { evaluateBudgetPolicy } from "../runtime/budget-policy.js";
import type { AgentRunBudgetLimit, AgentRunBudgetSnapshot } from "../runtime/run-budget.js";

const limit: AgentRunBudgetLimit = { maxSteps: 10, maxModelCalls: 10, maxTokens: 10000, maxCostUsd: 1 };

const cases: AgentRunBudgetSnapshot[] = [
  { steps: 3, modelCalls: 3, tokenBudget: { totalTokens: 3000, estimatedCostUsd: 0.3 } },
  { steps: 8, modelCalls: 6, tokenBudget: { totalTokens: 7000, estimatedCostUsd: 0.6 } },
  { steps: 10, modelCalls: 8, tokenBudget: { totalTokens: 8000, estimatedCostUsd: 0.8 } }
];

for (const value of cases) console.log(evaluateBudgetPolicy(value, limit));
