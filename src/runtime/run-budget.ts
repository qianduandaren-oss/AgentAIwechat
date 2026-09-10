import { BudgetGuard, type BudgetSnapshot } from "../observability/budget-guard.js";
import type { ModelPricing } from "../observability/model-pricing.js";
import type { TokenUsage } from "../observability/token-usage.js";

export interface AgentRunBudgetLimit {
  maxSteps: number;
  maxModelCalls: number;
  maxTokens: number;
  maxCostUsd: number;
}

export interface AgentRunBudgetSnapshot {
  steps: number;
  modelCalls: number;
  tokenBudget: BudgetSnapshot;
}

export class AgentRunBudgetExceededError extends Error {
  constructor(
    public readonly kind: "steps" | "model_calls",
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(`Agent run ${kind} budget exceeded: limit=${limit}, actual=${actual}`);
    this.name = "AgentRunBudgetExceededError";
  }
}

export class AgentRunBudget {
  private steps = 0;
  private modelCalls = 0;
  private readonly tokenBudget: BudgetGuard;

  constructor(private readonly limit: AgentRunBudgetLimit) {
    this.tokenBudget = new BudgetGuard({
      maxTokens: limit.maxTokens,
      maxCostUsd: limit.maxCostUsd
    });
  }

  recordStep(): void {
    const next = this.steps + 1;
    if (next > this.limit.maxSteps) {
      throw new AgentRunBudgetExceededError("steps", this.limit.maxSteps, next);
    }
    this.steps = next;
  }

  recordModelCall(usage: TokenUsage, pricing: ModelPricing): AgentRunBudgetSnapshot {
    const next = this.modelCalls + 1;
    if (next > this.limit.maxModelCalls) {
      throw new AgentRunBudgetExceededError("model_calls", this.limit.maxModelCalls, next);
    }

    const tokenBudget = this.tokenBudget.consume(usage, pricing);
    this.modelCalls = next;

    return {
      steps: this.steps,
      modelCalls: this.modelCalls,
      tokenBudget
    };
  }

  snapshot(): AgentRunBudgetSnapshot {
    return {
      steps: this.steps,
      modelCalls: this.modelCalls,
      tokenBudget: this.tokenBudget.snapshot()
    };
  }
}
