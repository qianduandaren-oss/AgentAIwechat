import type { LLMProvider } from "../llm/types.js";
import type { ReliabilityFailureKind } from "./reliability-fallback.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface ProviderCircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

interface ProviderCircuitState {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  halfOpenProbeInFlight: boolean;
}

export interface CircuitDecision {
  allowed: boolean;
  state: CircuitState;
  reason: string;
}

const HEALTH_FAILURES = new Set<ReliabilityFailureKind>([
  "timeout",
  "rate_limit",
  "server_error",
  "network"
]);

export class ProviderCircuitBreaker {
  private readonly states = new WeakMap<LLMProvider, ProviderCircuitState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: ProviderCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  beforeRequest(provider: LLMProvider): CircuitDecision {
    const current = this.get(provider);
    if (current.state === "closed") {
      return { allowed: true, state: "closed", reason: "provider circuit is closed" };
    }

    if (current.state === "open") {
      const elapsed = this.now() - (current.openedAt ?? this.now());
      if (elapsed < this.cooldownMs) {
        return { allowed: false, state: "open", reason: "provider circuit is open during cooldown" };
      }
      current.state = "half_open";
      current.halfOpenProbeInFlight = false;
    }

    if (current.halfOpenProbeInFlight) {
      return { allowed: false, state: "half_open", reason: "half-open probe is already in flight" };
    }

    current.halfOpenProbeInFlight = true;
    return { allowed: true, state: "half_open", reason: "allow one half-open recovery probe" };
  }

  recordSuccess(provider: LLMProvider): void {
    const current = this.get(provider);
    current.state = "closed";
    current.consecutiveFailures = 0;
    current.openedAt = undefined;
    current.halfOpenProbeInFlight = false;
  }

  recordFailure(provider: LLMProvider, kind: ReliabilityFailureKind): void {
    const current = this.get(provider);
    current.halfOpenProbeInFlight = false;
    if (!HEALTH_FAILURES.has(kind)) return;

    current.consecutiveFailures += 1;
    if (current.state === "half_open" || current.consecutiveFailures >= this.failureThreshold) {
      current.state = "open";
      current.openedAt = this.now();
    }
  }

  snapshot(provider: LLMProvider) {
    const current = this.get(provider);
    return {
      state: current.state,
      consecutiveFailures: current.consecutiveFailures,
      openedAt: current.openedAt
    };
  }

  private get(provider: LLMProvider): ProviderCircuitState {
    let current = this.states.get(provider);
    if (!current) {
      current = {
        state: "closed",
        consecutiveFailures: 0,
        halfOpenProbeInFlight: false
      };
      this.states.set(provider, current);
    }
    return current;
  }
}
