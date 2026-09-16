import type { LLMProvider, LLMRequest } from "../llm/types.js";
import { TimeoutError } from "./resilience.js";

export type ReliabilityFailureKind =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "network"
  | "deterministic"
  | "unknown";

export interface ReliabilityFallbackDecision {
  shouldFallback: boolean;
  kind: ReliabilityFailureKind;
  reason: string;
}

export function classifyReliabilityFailure(error: unknown): ReliabilityFallbackDecision {
  if (error instanceof TimeoutError) {
    return { shouldFallback: true, kind: "timeout", reason: "primary provider timed out after retries" };
  }

  if (!(error instanceof Error)) {
    return { shouldFallback: false, kind: "unknown", reason: "non-error failure is not eligible for provider fallback" };
  }

  const message = error.message;
  if (/(401|403|unauthori[sz]ed|forbidden|invalid.?api.?key|permission)/i.test(message)) {
    return { shouldFallback: false, kind: "deterministic", reason: "authentication or permission failures must not be hidden by fallback" };
  }
  if (/(400|invalid.?request|schema|validation|bad.?request)/i.test(message)) {
    return { shouldFallback: false, kind: "deterministic", reason: "request or schema failures must be fixed instead of routed elsewhere" };
  }
  if (/(429|rate.?limit)/i.test(message)) {
    return { shouldFallback: true, kind: "rate_limit", reason: "primary provider remained rate limited after retries" };
  }
  if (/5\d\d|temporar|unavailable/i.test(message)) {
    return { shouldFallback: true, kind: "server_error", reason: "primary provider remained unavailable after retries" };
  }
  if (/(connection|network|ECONN|socket)/i.test(message)) {
    return { shouldFallback: true, kind: "network", reason: "primary provider network failure remained after retries" };
  }

  return { shouldFallback: false, kind: "unknown", reason: "failure is not classified as safely recoverable" };
}

export interface ReliabilityInvokerOptions {
  primary: LLMProvider;
  fallback?: LLMProvider;
  invoke: (provider: LLMProvider, request: LLMRequest) => Promise<unknown>;
  onFallback?: (decision: ReliabilityFallbackDecision) => void;
}

export async function invokeWithReliabilityFallback(
  request: LLMRequest,
  options: ReliabilityInvokerOptions
): Promise<unknown> {
  try {
    return await options.invoke(options.primary, request);
  } catch (error) {
    const decision = classifyReliabilityFailure(error);
    if (!decision.shouldFallback || !options.fallback || options.fallback === options.primary) {
      throw error;
    }

    options.onFallback?.(decision);
    return options.invoke(options.fallback, request);
  }
}
