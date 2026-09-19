# Day 29 Evening - Run Admission Runtime Integration

## Goal

Integrate the bounded `RunAdmissionController` into `ProductionAgentRuntime` so every Agent run must acquire a global runtime slot before creating Trace, Tool Executor, Budget and entering the Agent Loop.

## Runtime boundary

```text
incoming run
  -> admission.acquire()
     -> admitted: run Agent
     -> queued: wait FIFO
     -> full: RUN_OVERLOADED
  -> finally release()
```

`ProductionRuntimeOptions` now exposes `maxConcurrentRuns` and `maxQueuedRuns`, defaulting to 20 and 50. `admission()` exposes a read-only snapshot for later health/metrics integration.

The release is executed in `finally`, so successful runs, LLM failures, Tool failures and thrown exceptions all return the slot.

## Current boundary

Implemented now: bounded concurrent runs, bounded FIFO queue, overload rejection, runtime-level admission snapshot.

Not implemented yet: queue deadline, AbortSignal cancellation, graceful shutdown/draining, HTTP 503/Retry-After mapping, metrics export.

## Next

Day 30 should add queue timeout/cancellation semantics and then connect them to graceful shutdown.