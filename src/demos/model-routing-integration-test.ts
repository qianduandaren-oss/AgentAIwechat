import type { LLMProvider, LLMRequest, MockRawLLMResponse } from "../llm/types.js";
import type { RuntimeConfig } from "../config/runtime-config.js";
import { ProductionAgentRuntime } from "../runtime/production-runtime.js";
import { ToolRegistry } from "../tools/registry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Model routing integration check failed: ${message}`);
}

class SequenceProvider implements LLMProvider {
  private index = 0;
  readonly requests: LLMRequest[] = [];

  constructor(private readonly responses: MockRawLLMResponse[]) {}

  async generate(request: LLMRequest): Promise<unknown> {
    this.requests.push(request);
    const response = this.responses[Math.min(this.index, this.responses.length - 1)];
    this.index += 1;
    return response;
  }
}

function config(): RuntimeConfig {
  return {
    environment: "test",
    llm: { provider: "mock", model: "mock-model", timeoutMs: 100, maxRetries: 1 },
    agent: { maxSteps: 4, maxModelCalls: 3, maxTokens: 50_000, maxCostUsd: 1 }
  };
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(
    {
      name: "echo",
      description: "Echo a value",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"]
      }
    },
    async args => ({ value: args.value })
  );
  return tools;
}

const primary = new SequenceProvider([
  {
    output: [
      { type: "tool_call", id: "call-1", name: "echo", arguments: { value: "known observation" } }
    ]
  },
  {
    output: [
      { type: "tool_call", id: "call-2", name: "echo", arguments: { value: "do not execute" } }
    ]
  }
]);
const economy = new SequenceProvider([
  { output: [{ type: "text", text: "economy final answer" }] }
]);

const runtime = new ProductionAgentRuntime(primary, registry(), {
  runtimeConfig: config(),
  budgetWarningThreshold: 0.6,
  economyProvider: economy
});

const result = await runtime.runStructured("route closing to the cheaper model");
assert(result.status === "completed", "closing run should complete");
assert(result.result.text === "economy final answer", "final text should come from economy provider");
assert(primary.requests.length === 2, `primary should receive two normal turns; got ${primary.requests.length}`);
assert(primary.requests.every(request => request.task === "agent_turn"), "primary should only receive agent_turn requests");
assert(economy.requests.length === 1, `economy should receive one request; got ${economy.requests.length}`);
assert(economy.requests[0].task === "agent_finalize", "economy should receive the finalize request");
assert((economy.requests[0].tools?.length ?? -1) === 0, "economy finalize request must keep tools disabled");

const routeSpans = result.result.trace.spans.filter(span => span.name.startsWith("model.route."));
assert(routeSpans.length === 3, `expected three model route spans; got ${routeSpans.length}`);
assert(
  routeSpans.filter(span => span.attributes?.modelTier === "primary").length === 2,
  "two normal turns should be traced as primary routes"
);
const economyRoute = routeSpans.find(span => span.attributes?.modelTier === "economy");
assert(economyRoute !== undefined, "finalize route should be traced as economy");
assert(economyRoute.attributes?.task === "agent_finalize", "economy route should identify agent_finalize task");
assert(
  economyRoute.attributes?.routeReason === "budget policy prefers cheaper model for finalization",
  "economy route should record the routing reason"
);
assert(economyRoute.attributes?.budgetState === "warning", "economy route should record warning budget state");

console.log("Cost-aware model routing integration checks passed");
