import type { AgentRunBudgetLimit, AgentRunBudgetSnapshot } from "./run-budget.js";

export type BudgetState = "healthy" | "warning" | "exhausted";

export interface BudgetPolicyDecision {
  state: BudgetState;
  usageRatio: number;
  allowExtraRetrieval: boolean;
  allowReflection: boolean;
  preferCheaperModel: boolean;
  shouldFinish: boolean;
}

function ratio(actual: number, limit: number): number {
  return limit <= 0 ? 1 : actual / limit;
}

export function evaluateBudgetPolicy(
  snapshot: AgentRunBudgetSnapshot,
  limit: AgentRunBudgetLimit,
  warningThreshold = 0.8
): BudgetPolicyDecision {
  const usageRatio = Math.max(
    ratio(snapshot.steps, limit.maxSteps),
    ratio(snapshot.modelCalls, limit.maxModelCalls),
    ratio(snapshot.tokenBudget.usage.totalTokens, limit.maxTokens),
    ratio(snapshot.tokenBudget.costUsd, limit.maxCostUsd)
  );

  if (usageRatio >= 1) return { state: "exhausted", usageRatio, allowExtraRetrieval: false, allowReflection: false, preferCheaperModel: true, shouldFinish: true };
  if (usageRatio >= warningThreshold) return { state: "warning", usageRatio, allowExtraRetrieval: false, allowReflection: false, preferCheaperModel: true, shouldFinish: false };
  return { state: "healthy", usageRatio, allowExtraRetrieval: true, allowReflection: true, preferCheaperModel: false, shouldFinish: false };
}
