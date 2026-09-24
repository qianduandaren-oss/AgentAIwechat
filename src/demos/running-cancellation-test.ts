import { runAgentLoop } from "../agent/agent-loop.js";
import type { LLMProvider } from "../llm/types.js";
import { AgentRunCancelledError } from "../runtime/run-cancellation.js";
import { ToolRegistry } from "../tools/registry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const provider: LLMProvider = {
  async generate() {
    throw new Error("provider should not be called after cancellation");
  }
};

const controller = new AbortController();
controller.abort();

let caught: unknown;
try {
  await runAgentLoop(provider, new ToolRegistry(), "cancel me", 3, {
    signal: controller.signal
  });
} catch (error) {
  caught = error;
}

assert(caught instanceof AgentRunCancelledError, "pre-aborted run should stop with AgentRunCancelledError");
console.log("running-cancellation-test: ok");
