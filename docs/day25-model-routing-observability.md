# Day 25 Evening - Model Routing Observability

Cost-aware routing is only production-ready when every routing decision is observable. The runtime now records a `model.route.<task>` trace span before each resilient LLM invocation.

Each route span records:

- `task`: `agent_turn` or `agent_finalize`
- `modelTier`: `primary` or `economy`
- `routeReason`: why the router selected that tier
- `budgetState`: current budget policy state
- `budgetUsageRatio`: current budget usage ratio

The routing decision remains separate from the LLM execution span. The existing LLM spans continue to own token, cost and latency metrics; route spans explain why a provider tier was selected. This keeps policy decisions observable without moving model selection into the Agent Loop.

The model-routing integration test now checks that two normal turns are traced as `primary`, the closing `agent_finalize` request is traced as `economy`, and the economy route records the warning budget state and routing reason.

Run locally with:

```bash
npm run test:model-routing
```
