import { calculateCost, type ModelPricing } from "./model-pricing.js";
import {
  EMPTY_TOKEN_USAGE,
  addTokenUsage,
  type TokenUsage
} from "./token-usage.js";

export interface BudgetLimit {
  maxTokens?: number;
  maxCostUsd?: number;
}

export interface BudgetSnapshot {
  usage: TokenUsage;
  costUsd: number;
  remainingTokens?: number;
  remainingCostUsd?: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: "tokens" | "cost",
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(`Agent ${kind} budget exceeded: limit=${limit}, actual=${actual}`);
    this.name = "BudgetExceededError";
  }
}

export class BudgetGuard {
  private usage: TokenUsage = { ...EMPTY_TOKEN_USAGE };
  private costUsd = 0;

  constructor(private readonly limit: BudgetLimit = {}) {}

  consume(usage: TokenUsage, pricing: ModelPricing): BudgetSnapshot {
    const nextUsage = addTokenUsage(this.usage, usage);
    const nextCost = this.costUsd + calculateCost(usage, pricing).totalCostUsd;

    if (this.limit.maxTokens !== undefined && nextUsage.totalTokens > this.limit.maxTokens) {
      throw new BudgetExceededError("tokens", this.limit.maxTokens, nextUsage.totalTokens);
    }
    if (this.limit.maxCostUsd !== undefined && nextCost > this.limit.maxCostUsd) {
      throw new BudgetExceededError("cost", this.limit.maxCostUsd, nextCost);
    }

    this.usage = nextUsage;
    this.costUsd = nextCost;
    return this.snapshot();
  }

  snapshot(): BudgetSnapshot {
    return {
      usage: { ...this.usage },
      costUsd: this.costUsd,
      ...(this.limit.maxTokens !== undefined
        ? { remainingTokens: Math.max(0, this.limit.maxTokens - this.usage.totalTokens) }
        : {}),
      ...(this.limit.maxCostUsd !== undefined
        ? { remainingCostUsd: Math.max(0, this.limit.maxCostUsd - this.costUsd) }
        : {})
    };
  }
}
