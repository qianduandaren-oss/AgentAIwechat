# Day 28 Morning — Production Readiness Gap Analysis

Date: 2026-09-18

## Goal

Before adding more runtime mechanisms, assess what the current Agent runtime already guarantees and what is still missing for a credible deployment.

## Current runtime chain

```text
User Request
  -> Guarded Context / Security Boundary
  -> Agent Loop
  -> Run Budget / Budget Policy
  -> Cost-aware Model Routing
  -> Provider Circuit Breaker
  -> Resilient LLM Invoker (timeout + retry)
  -> Reliability Fallback
  -> Tool Authorization / Approval / Idempotency
  -> Tracing / Audit / Structured Result
```

## Already implemented

- bounded Agent loop and structured run result;
- prompt-injection guard and sensitive-data projection;
- tool permission, approval, idempotency and audit boundaries;
- token/model-call/tool-call/cost budgets;
- warning-driven Closing Mode;
- primary/economy cost-aware routing;
- same-provider timeout/retry;
- transient-failure provider fallback;
- process-local CLOSED / OPEN / HALF_OPEN circuit breaker;
- tracing for model routing, circuit decisions and fallback events.

## Production-readiness gaps

### P0 — must be explicit before real traffic

1. **Durable state**: approvals, idempotency, audit and provider health are currently in-memory or process-local in important paths. Process restart or multiple replicas changes semantics.
2. **Configuration validation**: deployment must fail fast when required provider/model/security configuration is invalid; secrets must stay outside the repository.
3. **End-to-end verification**: repository integration tests exist, but a deployment pipeline must actually run build/tests before release.
4. **Operational limits**: request concurrency, queue/backpressure, global rate limits and shutdown/drain behavior need explicit policies.

### P1 — needed for observable operations

1. export traces/metrics to a real backend instead of keeping observability only inside a run;
2. define SLI/SLO signals such as success rate, p95 latency, fallback rate, circuit-open rate and cost per completed run;
3. expose health/readiness endpoints that distinguish process health from upstream provider health;
4. add deployment-level alerting and rollback signals.

### P2 — scale and optimization

1. shared/coarse provider health for multi-replica deployments when local circuits are insufficient;
2. provider pool/capability routing rather than only primary/economy/fallback roles;
3. persistent memory/RAG infrastructure and lifecycle policies;
4. workload-specific cost/quality evaluation before more aggressive model downgrades.

## Important boundary

A feature-complete Agent loop is not the same thing as a production-ready service. Production readiness means the runtime has explicit answers for state durability, failure isolation, release verification, traffic control and operations.

## Day 28 plan

Morning: establish the readiness gap map.

Noon: implement one concrete deployment boundary instead of starting another isolated demo. Prefer configuration/readiness validation that can be exercised in CI and container deployment.

Evening: consolidate Week 4 / Day 22–28 into the stage summary and checkpoint, keeping the checkpoint consistent with the actual repository state.
