# Day 34 Morning — Running Cancellation Propagation

Date: 2026-09-24

Day 30–33 completed queued cancellation and graceful shutdown boundaries. The remaining gap is cancellation after a run has already been admitted.

## Current boundary

`ProductionRunOptions.signal` currently reaches `RunAdmissionController.acquire()` only. After admission, `runAdmitted()` calls `runAgentLoop()` without passing the signal. `AgentLoopRuntimeOptions` has no signal field, and `LLMProvider.generate()` accepts only `LLMRequest`.

Therefore the current project supports queued cancellation, but not end-to-end running cancellation.

## Target propagation chain

```text
AbortSignal
  -> ProductionAgentRuntime
  -> Agent Loop
  -> LLM invocation boundary
  -> Tool execution boundary
```

Cancellation must be cooperative. At minimum, the loop should check the signal before starting a new LLM/tool step. Provider/tool implementations that support native abort should later receive the same signal so in-flight I/O can be interrupted.

## Important semantic boundary

Stopping future Agent steps is not the same as rolling back a Tool side effect. If a Tool has already sent a message, created an order, or written external state, aborting the Agent cannot pretend that action never happened. Side-effecting tools need idempotency, audit records, and where appropriate explicit compensation workflows.

## Day 34 plan

Morning: define cancellation semantics and audit the current propagation gap.

Noon: add a stable cancellation error and cooperative checkpoints to `runAgentLoop`, then pass `ProductionRunOptions.signal` into the loop without breaking existing providers.

Evening: test cancellation around LLM/tool boundaries and document which in-flight operations remain non-interruptible until provider/tool contracts become signal-aware.
