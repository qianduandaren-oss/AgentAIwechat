# Day 22 Noon — Structured AgentRunResult

Day 22 morning defined the external runtime contract. Noon wires it into the production path.

## Production path

```text
ProductionAgentRuntime.runStructured()
  -> run()
  -> runAgentLoop()
  -> success => { status: completed, stopReason: completed, result }
  -> error => toAgentRunResult(error)
```

## Current mappings

- `AgentRunBudgetExceededError(kind=steps)` -> `max_steps_reached`
- other `AgentRunBudgetExceededError` -> `budget_exceeded`
- `TimeoutError` -> `deadline_exceeded`
- recognizable permission/authorization denial -> `permission_denied`
- recognizable max-step errors -> `max_steps_reached`
- unknown errors -> `runtime_error`

`run()` is intentionally preserved for existing callers. New HTTP/CLI/Worker adapters should prefer `runStructured()` so callers do not parse error messages themselves.

## Known limitation

Some older modules still expose generic `Error` rather than typed domain errors, so `toAgentRunResult()` contains a compatibility fallback based on message classification. The next refinement should replace those fallbacks with typed errors at their source.
