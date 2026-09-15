# Day 25 Noon — Cost-aware Model Routing Integration

The runtime now owns model selection through `CostAwareModelRouter`.

- `agent_turn` stays on the primary provider.
- `agent_finalize` may use the economy provider when the current budget decision has `preferCheaperModel=true`.
- If no economy provider is configured, routing safely falls back to primary.
- The selected provider still runs through the existing resilient LLM invoker, so timeout/retry and the rest of the production path are preserved.
- Closing mode still sends `tools: []` and keeps prior observations.

Run the focused integration check with:

```bash
npm run test:model-routing
```

The test uses deterministic mock providers and verifies that two normal turns reach primary while the final closing request reaches economy.