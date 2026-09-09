import { callLLM } from "../llm/client.js";
import type { LLMProvider, LLMRequest } from "../llm/types.js";
import type { RuntimeConfig } from "../config/runtime-config.js";
import { TimeoutError, withRetry, withTimeout } from "./resilience.js";

function shouldRetryLLM(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof Error)) return false;
  return /(timeout|temporar|rate.?limit|429|5\d\d|connection|network)/i.test(error.message);
}

export function createResilientLLMInvoker(
  config: RuntimeConfig["llm"]
): (provider: LLMProvider, request: LLMRequest) => Promise<unknown> {
  return async (provider, request) =>
    withRetry(
      () => withTimeout(() => callLLM(provider, request), config.timeoutMs),
      { maxRetries: config.maxRetries, baseDelayMs: 200 },
      shouldRetryLLM
    );
}
