# Day 30 Evening — Cancellation Boundary

Date: 2026-09-20

## Current boundary

The runtime now distinguishes queue lifecycle from running lifecycle.

```text
Incoming Run
  -> Admission
     -> overloaded: RUN_OVERLOADED
     -> queued
        -> timeout: RUN_QUEUE_TIMEOUT
        -> abort: RUN_CANCELLED
        -> admitted
  -> Agent execution
     -> running cancellation propagation: not implemented yet
```

`RunAdmissionController` owns only admission and queue waiting. It removes timed-out or cancelled waiters, cleans timers/listeners, and prevents ghost waiters.

`ProductionAgentRuntime.run()` passes `queueTimeoutMs` and `AbortSignal` into admission, but after admission the signal is not yet propagated through Agent Loop, LLM Provider, or Tool Execution.

## Why keep this boundary

Admission should answer only whether a run may start. It should not know how to cancel LLM or tool work. Running cancellation belongs to the runtime execution path and provider/tool contracts.

## Next step

Day 31: graceful shutdown and draining.

Target lifecycle:

```text
RUNNING -> DRAINING -> STOPPED
```

During draining: reject new runs, remove/cancel queued runs, wait for active runs, then enforce a drain deadline. Full cancellation of already-running LLM/tool calls remains a separate follow-up until AbortSignal is propagated end-to-end.
