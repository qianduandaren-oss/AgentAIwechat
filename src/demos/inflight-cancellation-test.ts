import { runAgentLoop } from "../agent/agent-loop.js";
import type { LLMGenerateOptions, LLMProvider, LLMRequest } from "../llm/types.js";
import { ToolRegistry } from "../tools/registry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class AbortAwareProvider implements LLMProvider {
  started = false;
  aborted = false;

  async generate(_request: LLMRequest, options: LLMGenerateOptions = {}): Promise<unknown> {
    this.started = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ output: [{ type: "text", text: "too late" }] }), 5_000);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        this.aborted = true;
        reject(options.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    });
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error("condition not reached");
}

async function testLLMInFlightCancellation(): Promise<void> {
  const provider = new AbortAwareProvider();
  const controller = new AbortController();
  const run = runAgentLoop(provider, new ToolRegistry(), "hello", 2, { signal: controller.signal });
  await waitUntil(() => provider.started);
  controller.abort(new Error("user cancelled"));
  await run.then(
    () => { throw new Error("run should reject after cancellation"); },
    () => undefined
  );
  assert(provider.aborted, "provider should observe AbortSignal while request is in flight");
}

async function testToolInFlightCancellation(): Promise<void> {
  let toolStarted = false;
  let toolAborted = false;
  const provider: LLMProvider = {
    async generate(): Promise<unknown> {
      return { output: [{ type: "tool_call", id: "call-1", name: "slow_tool", arguments: {} }] };
    }
  };
  const registry = new ToolRegistry();
  registry.register(
    { name: "slow_tool", description: "abort-aware slow tool", inputSchema: { type: "object", properties: {} } },
    async (_args, context) => new Promise((resolve, reject) => {
      toolStarted = true;
      const timer = setTimeout(() => resolve("too late"), 5_000);
      context?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        toolAborted = true;
        reject(context.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    })
  );
  const controller = new AbortController();
  const run = runAgentLoop(provider, registry, "run slow tool", 2, { signal: controller.signal });
  await waitUntil(() => toolStarted);
  controller.abort(new Error("user cancelled"));
  await run.then(
    () => { throw new Error("run should reject after cancellation"); },
    () => undefined
  );
  assert(toolAborted, "tool handler should observe AbortSignal while work is in flight");
}

await testLLMInFlightCancellation();
await testToolInFlightCancellation();
console.log("in-flight cancellation tests passed");
