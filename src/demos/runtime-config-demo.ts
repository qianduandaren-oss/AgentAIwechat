import { loadRuntimeConfig } from "../config/runtime-config.js";
import { createLLMProvider } from "../llm/provider-factory.js";

function runCase(name: string, env: NodeJS.ProcessEnv): void {
  try {
    const config = loadRuntimeConfig(env);
    createLLMProvider(config);
    console.log(`[PASS] ${name}`, config);
  } catch (error) {
    console.log(`[FAIL FAST] ${name}:`, error instanceof Error ? error.message : error);
  }
}

runCase("valid mock config", {
  NODE_ENV: "production",
  LLM_PROVIDER: "mock",
  LLM_MODEL: "mock-model",
  LLM_TIMEOUT_MS: "10000",
  LLM_MAX_RETRIES: "2"
});

runCase("invalid timeout", {
  NODE_ENV: "production",
  LLM_PROVIDER: "mock",
  LLM_TIMEOUT_MS: "abc"
});

runCase("unsupported provider", {
  NODE_ENV: "production",
  LLM_PROVIDER: "unknown"
});
