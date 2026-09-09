import { BudgetGuard, BudgetExceededError } from "../observability/budget-guard.js";
import { calculateCost, type ModelPricing } from "../observability/model-pricing.js";
import type { TokenUsage } from "../observability/token-usage.js";

const pricing: ModelPricing = {
  model: "demo-model",
  inputPerMillionUsd: 2,
  outputPerMillionUsd: 8
};

const usage: TokenUsage = {
  inputTokens: 8_000,
  outputTokens: 2_000,
  totalTokens: 10_000,
  source: "provider"
};

console.log("cost", calculateCost(usage, pricing));

const guard = new BudgetGuard({ maxTokens: 18_000, maxCostUsd: 0.2 });
console.log("after run 1", guard.consume(usage, pricing));

try {
  console.log("after run 2", guard.consume(usage, pricing));
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log("budget blocked", {
      kind: error.kind,
      limit: error.limit,
      actual: error.actual
    });
  } else {
    throw error;
  }
}
