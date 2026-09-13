import type { LLMProvider, LLMRequest, MockRawLLMResponse } from "../llm/types.js";
import type { RuntimeConfig } from "../config/runtime-config.js";
import { ProductionAgentRuntime } from "../runtime/production-runtime.js";
import { ToolRegistry } from "../tools/registry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Integration check failed: ${message}`);
}

function config(overrides: Partial<RuntimeConfig["agent"]> = {}, timeoutMs = 100): RuntimeConfig {
  return {
    environment: "test",
    llm: {
      provider: "mock",
      model: "mock-model",
      timeoutMs,
      maxRetries: 1
    },
    agent: {
      maxSteps: 4,
      maxModelCalls: 6,
      maxTokens: 50_000,
      maxCostUsd: 1,
      ...overrides
    }
  };
}

class SequenceProvider implements LLMProvider {
  private index = 0;

  constructor(private readonly responses: MockRawLLMResponse[]) {}

  async generate(_request: LLMRequest): Promise<unknown> {
    const response = this.responses[Math.min(this.index, this.responses.length - 1)];
    this.index += 1;
    return response;
  }
}

class SlowProvider implements LLMProvider {
  async generate(_request: LLMRequest): Promise<unknown> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { output: [{ type: "text", text: "too late" }] } satisfies MockRawLLMResponse;
  }
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    {
      name: "echo",
      description: "Echo a value for runtime integration checks",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"]
      }
    },
    async args => ({ value: args.value })
  );
  return registry;
}

async function checkCompletedRun() {
  const provider = new SequenceProvider([
    { output: [{ type: "text", text: "runtime ok" }] }
  ]);
  const runtime = new ProductionAgentRuntime(provider, createRegistry(), {
    runtimeConfig: config()
  });

  const result = await runtime.runStructured("say hello");
  assert(result.status === "completed", "successful runtime should complete");
  assert(result.stopReason === "completed", "successful runtime should use completed stop reason");
  assert(result.result.text === "runtime ok", "successful runtime should preserve final text");
}

async function checkBudgetStop() {
  const provider = new SequenceProvider([
    {
      output: [
        { type: "tool_call", id: "call-1", name: "echo", arguments: { value: "first" } }
      ]
    },
    { output: [{ type: "text", text: "second model call" }] }
  ]);
  const runtime = new ProductionAgentRuntime(provider, createRegistry(), {
    runtimeConfig: config({ maxModelCalls: 1 })
  });

  const result = await runtime.runStructured("use echo then answer");
  assert(result.status !== "completed", "model-call budget should stop the run");
  assert(result.stopReason === "budget_exceeded", `expected budget_exceeded, got ${result.stopReason}`);
}

async function checkTimeoutStop() {
  const runtime = new ProductionAgentRuntime(new SlowProvider(), createRegistry(), {
    runtimeConfig: config({}, 10)
  });

  const result = await runtime.runStructured("wait too long");
  assert(result.status !== "completed", "timeout should stop the run");
  assert(result.stopReason === "deadline_exceeded", `expected deadline_exceeded, got ${result.stopReason}`);
}

await checkCompletedRun();
await checkBudgetStop();
await checkTimeoutStop();

console.log("Production runtime integration checks passed");
