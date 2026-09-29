import type {
  LLMGenerateOptions,
  LLMProvider,
  LLMRequest
} from "../llm/types.js";
import { createResilientLLMInvoker } from "../runtime/llm-invoker.js";
import { invokeWithReliabilityFallback } from "../runtime/reliability-fallback.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

class AbortAwareProvider implements LLMProvider {
  calls = 0;
  aborted = false;

  async generate(
    _request: LLMRequest,
    options: LLMGenerateOptions = {}
  ): Promise<unknown> {
    this.calls += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("temporary network failure")),
        5_000
      );

      options.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          this.aborted = true;
          reject(options.signal?.reason ?? new Error("cancelled"));
        },
        { once: true }
      );
    });
  }
}

const request: LLMRequest = {
  task: "agent_turn",
  messages: [{ role: "user", content: "hello" }]
};

const primary = new AbortAwareProvider();
const fallback = new AbortAwareProvider();
const controller = new AbortController();
const resilientInvoker = createResilientLLMInvoker({
  provider: "test",
  model: "test",
  timeoutMs: 10_000,
  maxRetries: 2
});

const run = invokeWithReliabilityFallback(
  request,
  {
    primary,
    fallback,
    invoke: resilientInvoker
  },
  { signal: controller.signal }
);

setTimeout(() => controller.abort(new Error("user cancelled")), 10);

await run.then(
  () => {
    throw new Error("cancelled invocation should reject");
  },
  () => undefined
);

assert(primary.calls === 1, "cancellation must prevent retry");
assert(primary.aborted, "primary provider should receive AbortSignal");
assert(fallback.calls === 0, "cancellation must prevent fallback");

console.log("resilient cancellation test passed");
