import { AgentRunBudget, AgentRunBudgetExceededError } from "../runtime/run-budget.js";
import { BudgetExceededError } from "../observability/budget-guard.js";
import type { ModelPricing } from "../observability/model-pricing.js";
import type { TokenUsage } from "../observability/token-usage.js";

const pricing: ModelPricing = {
  model: "demo-model",
  inputPerMillionUsd: 2,
  outputPerMillionUsd: 8
};

const usage: TokenUsage = {
  inputTokens: 1_000,
  outputTokens: 500,
  totalTokens: 1_500,
  source: "provider"
};

function showError(label: string, error: unknown): void {
  if (error instanceof AgentRunBudgetExceededError) {
    console.log(label, {
      kind: error.kind,
      limit: error.limit,
      actual: error.actual
    });
    return;
  }
  if (error instanceof BudgetExceededError) {
    console.log(label, {
      kind: error.kind,
      limit: error.limit,
      actual: error.actual
    });
    return;
  }
  throw error;
}

const modelCallBudget = new AgentRunBudget({
  maxSteps: 3,
  maxModelCalls: 1,
  maxTokens: 10_000,
  maxCostUsd: 1
});

modelCallBudget.recordStep();
console.log("model call 1", modelCallBudget.recordModelCall(usage, pricing));
try {
  modelCallBudget.recordModelCall(usage, pricing);
} catch (error) {
  showError("model call blocked", error);
}

const tokenBudget = new AgentRunBudget({
  maxSteps: 3,
  maxModelCalls: 5,
  maxTokens: 2_000,
  maxCostUsd: 1
});

tokenBudget.recordStep();
console.log("token run 1", tokenBudget.recordModelCall(usage, pricing));
try {
  tokenBudget.recordModelCall(usage, pricing);
} catch (error) {
  showError("token budget blocked", error);
}

const stepBudget = new AgentRunBudget({
  maxSteps: 1,
  maxModelCalls: 5,
  maxTokens: 10_000,
  maxCostUsd: 1
});

stepBudget.recordStep();
try {
  stepBudget.recordStep();
} catch (error) {
  showError("step budget blocked", error);
}
