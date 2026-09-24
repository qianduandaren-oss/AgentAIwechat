# Day 34 Noon — Cooperative Running Cancellation

Day 34 noon propagates `ProductionRunOptions.signal` into `runAgentLoop` and adds cooperative cancellation checkpoints before LLM calls, after LLM returns, before each tool call, and after each tool returns.

A stable `AgentRunCancelledError` with code `RUN_CANCELLED` represents cancellation, and `runStructured()` maps it to `{ status: "stopped", stopReason: "cancelled" }`.

This is deliberately cooperative cancellation only. It prevents new Agent steps from starting after cancellation is observed, but it does not yet abort an LLM HTTP request or Tool I/O already in flight. Provider- and Tool-level AbortSignal propagation is the next boundary.

Run the focused check with:

```bash
npm run test:running-cancellation
```
