import type { TokenUsage } from "./token-usage.js";

export interface ModelPricing {
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export const ZERO_PRICING: ModelPricing = {
  model: "unpriced",
  inputPerMillionUsd: 0,
  outputPerMillionUsd: 0
};

export function calculateCost(
  usage: TokenUsage,
  pricing: ModelPricing
): CostBreakdown {
  const inputCostUsd = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd
  };
}
