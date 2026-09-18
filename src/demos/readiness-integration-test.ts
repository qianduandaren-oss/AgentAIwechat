import type { RuntimeConfig } from "../config/runtime-config.js";
import { validateRuntimeReadiness } from "../runtime/readiness.js";

const base: RuntimeConfig = {
  environment: "production",
  llm: { provider: "openai", model: "gpt", timeoutMs: 15_000, maxRetries: 2 },
  agent: { maxSteps: 8, maxModelCalls: 12, maxTokens: 50_000, maxCostUsd: 1 }
};

const ready = validateRuntimeReadiness(base);
if (!ready.ready) throw new Error(`Expected ready config: ${JSON.stringify(ready.issues)}`);

const invalid = validateRuntimeReadiness({
  ...base,
  llm: { ...base.llm, provider: "mock", timeoutMs: 50 },
  agent: { ...base.agent, maxModelCalls: 4, maxTokens: 50 }
});

const codes = new Set(invalid.issues.map(issue => issue.code));
for (const expected of ["mock_provider_in_production", "llm_timeout_too_low", "model_call_budget_too_low", "token_budget_too_low"]) {
  if (!codes.has(expected)) throw new Error(`Missing readiness issue: ${expected}`);
}
if (invalid.ready) throw new Error("Expected invalid config to be not ready");

console.log("Runtime readiness integration test passed");
