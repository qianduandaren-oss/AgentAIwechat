import { callLLM } from "../llm/client.js";
import type {
  LLMGenerateOptions,
  LLMProvider,
  LLMRequest
} from "../llm/types.js";
import type { RuntimeConfig } from "../config/runtime-config.js";
import { TimeoutError, withRetry, withTimeout } from "./resilience.js";

function shouldRetryLLM(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof Error)) return false;
  return /(timeout|temporar|rate.?limit|429|5\d\d|connection|network)/i.test(error.message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("LLM request cancelled");
  }
}

function mergeAbortSignals(
  externalSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal
): AbortSignal {
  if (!externalSignal) return timeoutSignal;
  const controller = new AbortController();

  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  if (externalSignal.aborted) abortFrom(externalSignal);
  if (timeoutSignal.aborted) abortFrom(timeoutSignal);

  externalSignal.addEventListener("abort", () => abortFrom(externalSignal), {
    once: true
  });
  timeoutSignal.addEventListener("abort", () => abortFrom(timeoutSignal), {
    once: true
  });

  return controller.signal;
}

export function createResilientLLMInvoker(
  config: RuntimeConfig["llm"]
): (
  provider: LLMProvider,
  request: LLMRequest,
  options?: LLMGenerateOptions
) => Promise<unknown> {
  return async (provider, request, options = {}) =>
    withRetry(
      () => {
        throwIfAborted(options.signal);
        return withTimeout(
          timeoutSignal =>
            callLLM(provider, request, {
              signal: mergeAbortSignals(options.signal, timeoutSignal)
            }),
          config.timeoutMs
        );
      },
      { maxRetries: config.maxRetries, baseDelayMs: 200 },
      error => !options.signal?.aborted && shouldRetryLLM(error)
    );
}
