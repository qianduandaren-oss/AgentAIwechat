# Day 24 Evening — Closing Mode Checkpoint

## Runtime state transition

```text
normal
  ↓ budget warning
closing
  ↓ final LLM call, tools=[]
finished
```

## Current guarantees

- `warning` can trigger closing mode instead of executing newly proposed tool calls.
- Closing uses `task: agent_finalize` and `tools: []`.
- Existing tool observations stay in the message history for the final answer.
- Hard model-call/step/token/cost limits remain enforced by `AgentRunBudget`; closing does not bypass them.
- If the final closing model call itself exceeds a hard budget, the runtime throws the budget error and `runStructured()` maps it to the structured stop reason.

## Integration coverage

`src/demos/production-runtime-integration-test.ts` currently checks:

- completed run
- model-call budget stop
- timeout stop
- closing mode: no new tool execution, one finalize call, tools disabled, prior observation retained

## Next engineering step

Day 25 should focus on model routing / cost-aware provider selection. The existing budget policy already exposes `preferCheaperModel`; the next step is to turn that policy signal into a real routing decision without weakening runtime contracts or observability.
