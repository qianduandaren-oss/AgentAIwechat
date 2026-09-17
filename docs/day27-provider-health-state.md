# Day 27 Evening — Provider Health State Boundaries

Date: 2026-09-17

## What the runtime has now

The production runtime keeps `ProviderCircuitBreaker` as instance state, so circuit state survives across multiple `run()` calls handled by the same runtime instance.

State machine:

```text
CLOSED
  -> transient failures reach threshold -> OPEN
OPEN
  -> cooldown expires -> HALF_OPEN
HALF_OPEN
  -> probe succeeds -> CLOSED
  -> probe fails -> OPEN
```

## State ownership

Current implementation is **process-local memory**. This is correct for a single Node.js process and useful as the first production boundary, but it is not shared across replicas.

With multiple runtime instances:

```text
instance A: primary = OPEN
instance B: primary = CLOSED
instance C: primary = CLOSED
```

Therefore local circuit state protects one process from repeated failures but cannot provide globally consistent provider health.

## When to consider shared health

Do not immediately move the whole circuit breaker to Redis. Shared state introduces synchronization, expiry, failure-mode and hot-key concerns. A practical evolution is:

1. keep local fast circuit decisions;
2. publish provider health metrics/events;
3. aggregate health outside the request path;
4. only introduce shared coarse health when multi-replica traffic needs coordinated isolation.

## Runtime contract

- Retry handles one provider call.
- Reliability fallback handles one request.
- Circuit breaker remembers recent provider failures across requests in one runtime instance.
- Distributed health coordinates multiple runtime instances.

The current project implements the first three layers. Distributed shared provider health is intentionally not implemented yet.
