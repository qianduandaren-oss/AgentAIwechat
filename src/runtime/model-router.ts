import type { LLMProvider, LLMRequest } from "../llm/types.js";
import type { BudgetPolicyDecision } from "./budget-policy.js";

export interface ModelRouteContext {
  budget?: BudgetPolicyDecision;
}

export interface ModelRouteDecision {
  provider: LLMProvider;
  tier: "primary" | "economy";
  reason: string;
}

export class CostAwareModelRouter {
  constructor(
    private readonly primary: LLMProvider,
    private readonly economy?: LLMProvider
  ) {}

  select(request: LLMRequest, context: ModelRouteContext = {}): ModelRouteDecision {
    const shouldUseEconomy =
      request.task === "agent_finalize" &&
      context.budget?.preferCheaperModel === true &&
      this.economy !== undefined;

    if (shouldUseEconomy) {
      return {
        provider: this.economy!,
        tier: "economy",
        reason: "budget policy prefers cheaper model for finalization"
      };
    }

    return {
      provider: this.primary,
      tier: "primary",
      reason: request.task === "agent_finalize"
        ? "economy provider unavailable or budget does not prefer cheaper model"
        : "normal agent turn uses primary provider"
    };
  }
}
