import type { RuntimeConfig } from "../config/runtime-config.js";
import type { LLMProvider, LLMRequest, MockRawLLMResponse } from "../llm/types.js";
import { ProductionAgentRuntime } from "../runtime/production-runtime.js";
import { ToolRegistry } from "../tools/registry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Reliability fallback integration check failed: ${message}`);
}

class FailingProvider implements LLMProvider {
  calls = 0;
  constructor(private readonly errorFactory: () => Error) {}
  async generate(_request: LLMRequest): Promise<unknown> {
    this.calls += 1;
    throw this.errorFactory();
  }
}

class RecordingProvider implements LLMProvider {
  readonly requests: LLMRequest[] = [];
  constructor(private readonly response: MockRawLLMResponse) {}
  async generate(request: LLMRequest): Promise<unknown> {
    this.requests.push(request);
    return this.response;
  }
}

function config(): RuntimeConfig {
  return {
    environment: "test",
    llm: { provider: "mock", model: "mock-model", timeoutMs: 50, maxRetries: 1 },
    agent: { maxSteps: 2, maxModelCalls: 4, maxTokens: 50_000, maxCostUsd: 1 }
  };
}

const emptyRegistry = new ToolRegistry();

const rateLimitedPrimary = new FailingProvider(() => new Error("429 rate limit"));
const healthyFallback = new RecordingProvider({ output: [{ type: "text", text: "fallback answer" }] });
const recovered = await new ProductionAgentRuntime(rateLimitedPrimary, emptyRegistry, {
  runtimeConfig: config(),
  fallbackProvider: healthyFallback
}).runStructured("recover from provider rate limit");

assert(recovered.status === "completed", "recoverable provider failure should complete through fallback");
assert(recovered.result.text === "fallback answer", "fallback provider should produce the final answer");
assert(rateLimitedPrimary.calls === 2, `primary should retry once before fallback; got ${rateLimitedPrimary.calls}`);
assert(healthyFallback.requests.length === 1, "fallback provider should be called once");
const fallbackSpan = recovered.result.trace.spans.find(span => span.name === "model.fallback.agent_turn");
assert(fallbackSpan !== undefined, "reliability fallback should be visible in trace");
assert(fallbackSpan.attributes?.routeType === "reliability", "trace should distinguish reliability from cost routing");
assert(fallbackSpan.attributes?.failureKind === "rate_limit", "trace should record the failure classification");

const invalidPrimary = new FailingProvider(() => new Error("401 unauthorized invalid api key"));
const mustStayUnused = new RecordingProvider({ output: [{ type: "text", text: "must not run" }] });
const rejected = await new ProductionAgentRuntime(invalidPrimary, emptyRegistry, {
  runtimeConfig: config(),
  fallbackProvider: mustStayUnused
}).runStructured("do not hide deterministic failures");

assert(rejected.status === "stopped", "deterministic provider failure should remain stopped");
assert(invalidPrimary.calls === 1, `401 should not be retried; got ${invalidPrimary.calls}`);
assert(mustStayUnused.requests.length === 0, "401 must not trigger provider fallback");

console.log("Reliability fallback integration checks passed");
