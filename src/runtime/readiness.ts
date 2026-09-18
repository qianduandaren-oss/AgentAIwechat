import type { RuntimeConfig } from "../config/runtime-config.js";

export interface ReadinessIssue {
  code: string;
  message: string;
}

export interface RuntimeReadinessReport {
  ready: boolean;
  issues: ReadinessIssue[];
}

export function validateRuntimeReadiness(config: RuntimeConfig): RuntimeReadinessReport {
  const issues: ReadinessIssue[] = [];

  if (!config.llm.provider.trim()) {
    issues.push({ code: "llm_provider_missing", message: "LLM provider must be configured" });
  }
  if (!config.llm.model.trim()) {
    issues.push({ code: "llm_model_missing", message: "LLM model must be configured" });
  }
  if (config.environment === "production" && config.llm.provider === "mock") {
    issues.push({ code: "mock_provider_in_production", message: "Production cannot use the mock LLM provider" });
  }
  if (config.llm.timeoutMs < 100) {
    issues.push({ code: "llm_timeout_too_low", message: "LLM timeout must be at least 100ms" });
  }
  if (config.agent.maxModelCalls < config.agent.maxSteps) {
    issues.push({ code: "model_call_budget_too_low", message: "maxModelCalls should be >= maxSteps" });
  }
  if (config.agent.maxTokens < 100) {
    issues.push({ code: "token_budget_too_low", message: "Agent token budget must be at least 100" });
  }

  return { ready: issues.length === 0, issues };
}

export function assertRuntimeReady(config: RuntimeConfig): void {
  const report = validateRuntimeReadiness(config);
  if (!report.ready) {
    const detail = report.issues.map(issue => `${issue.code}: ${issue.message}`).join("; ");
    throw new Error(`Runtime readiness validation failed: ${detail}`);
  }
}
