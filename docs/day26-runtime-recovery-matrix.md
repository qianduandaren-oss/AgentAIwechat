# Day 26 Evening — Runtime Recovery Matrix

日期：2026-09-16

## Recovery Matrix

| Failure / Signal | Same-provider Retry | Cross-provider Fallback | Cost Route | Expected result |
| --- | --- | --- | --- | --- |
| transient timeout | yes | after retries | no | recover or stop |
| 429 rate limit | yes | after retries | no | recover or stop |
| 5xx / temporary unavailable | yes | after retries | no | recover or stop |
| network / connection | yes | after retries | no | recover or stop |
| 401 / 403 | no | no | no | fail fast |
| invalid request / schema | no | no | no | fail fast |
| budget warning + agent_finalize | n/a | only on provider failure | economy preferred | graceful closing |
| hard budget exhausted | no extra recovery that violates budget | no | no | hard stop |

## Runtime chain

```text
Budget Policy
  ↓
Cost-aware Model Router
  ↓
Selected Provider
  ↓
Resilient Invoker
  ├─ timeout
  └─ same-provider retry
  ↓ still failed
Failure Classification
  ├─ deterministic → stop
  └─ transient → Reliability Fallback (max once)
                      ↓
                 fallback provider
```

## Cost accounting rule

Fallback is recovery, not a free retry. Every actual LLM attempt still consumes latency/provider quota, while successful parsed LLM responses continue through the normal Agent run accounting path. Production cost dashboards should therefore distinguish route decisions, retry attempts, and fallback events rather than treating a recovered request as a single invisible call.

## Trace rule

Keep cost routing and reliability routing semantically separate:

- `model.route.<task>`: why the Runtime selected the initial tier.
- `model.fallback.<task>`: why the selected provider was abandoned after its retry policy was exhausted.
- The fallback span should remain in the same Agent trace so an operator can reconstruct the failure and recovery chain.

## Guardrails

1. Retry first, fallback second.
2. Deterministic failures fail fast.
3. One request gets at most one cross-provider fallback in the current implementation.
4. Never ping-pong between providers.
5. Recovery must not bypass timeout, retry, security, tracing, or hard budget limits.
