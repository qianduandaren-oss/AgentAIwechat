import type { LLMProvider } from "../llm/types.js";
import { ProviderCircuitBreaker } from "../runtime/provider-circuit-breaker.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const provider: LLMProvider = {
  async generate() {
    return { output: [{ type: "text", text: "ok" }] };
  }
};

let now = 1_000;
const breaker = new ProviderCircuitBreaker({
  failureThreshold: 2,
  cooldownMs: 5_000,
  now: () => now
});

assert(breaker.beforeRequest(provider).state === "closed", "provider starts closed");
breaker.recordFailure(provider, "timeout");
assert(breaker.snapshot(provider).state === "closed", "one transient failure stays closed");

assert(breaker.beforeRequest(provider).allowed, "second request is still allowed");
breaker.recordFailure(provider, "rate_limit");
assert(breaker.snapshot(provider).state === "open", "threshold opens the circuit");
assert(!breaker.beforeRequest(provider).allowed, "open circuit blocks requests during cooldown");

now += 5_000;
const probe = breaker.beforeRequest(provider);
assert(probe.allowed && probe.state === "half_open", "cooldown allows one half-open probe");
assert(!breaker.beforeRequest(provider).allowed, "parallel half-open probes are blocked");

breaker.recordSuccess(provider);
assert(breaker.snapshot(provider).state === "closed", "successful probe closes the circuit");
assert(breaker.snapshot(provider).consecutiveFailures === 0, "success resets failure count");

breaker.recordFailure(provider, "deterministic");
assert(breaker.snapshot(provider).state === "closed", "deterministic failures do not damage provider health");

console.log("Provider circuit breaker integration checks passed.");
