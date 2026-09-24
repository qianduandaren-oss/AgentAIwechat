# Day 34 Evening — In-flight Running Cancellation

Day 34 noon added cooperative checkpoints. Evening extends the cancellation contract into LLM providers and ordinary tool handlers.

## Propagation

`ProductionRunOptions.signal -> AgentLoopRuntimeOptions.signal -> LLMProvider.generate(..., { signal })`

`ProductionRunOptions.signal -> AgentLoopRuntimeOptions.signal -> executeTool(..., { signal }) -> ToolHandler(args, { signal })`

A provider backed by `fetch` should pass the same signal to `fetch`. A tool that owns cancellable I/O should do the same.

## Boundaries

- Default LLM provider contract is now signal-aware.
- Custom `llmInvoker` receives the same options and must forward them through retry/fallback layers.
- Ordinary ToolHandler receives a signal-aware execution context.
- `SecureToolExecutor` is not yet signal-aware; the Agent Loop still prevents starting a new secure tool after cancellation, but cannot interrupt one already in flight.
- Cancellation never rolls back an external side effect that already completed.

## Check

Run `npm run test:inflight-cancellation` to compile and exercise an abort-aware LLM provider plus an abort-aware tool handler.
