# Day 27 Noon — Provider Circuit Breaker Integration

The production runtime now keeps provider-health state across agent runs.

## State machine

`closed -> open -> half_open -> closed/open`

- transient failures (`timeout`, `rate_limit`, `server_error`, `network`) increment the provider failure counter;
- reaching `failureThreshold` opens the circuit;
- requests during `cooldownMs` skip the unhealthy provider;
- after cooldown, only one half-open probe is allowed;
- a successful probe closes and resets the circuit;
- a transient failed probe opens it again;
- deterministic request/auth/schema failures do not damage provider health.

## Runtime integration

`ProductionAgentRuntime` owns one persistent `ProviderCircuitBreaker`, so health survives individual `run()` calls. The circuit check happens after cost-aware routing but before provider invocation. When a selected provider is open and a distinct fallback exists, the runtime bypasses the unhealthy provider and records a reliability fallback trace with `failureKind=circuit_open`.

## Check

Run:

```bash
npm run test:circuit-breaker
```

The deterministic test uses an injected clock to verify closed, open, cooldown, half-open probe gating, recovery, and deterministic-error isolation.
