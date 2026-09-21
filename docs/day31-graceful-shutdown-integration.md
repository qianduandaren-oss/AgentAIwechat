# Day 31 Evening — Graceful Shutdown Integration

The production runtime now owns an explicit lifecycle: `RUNNING -> DRAINING -> STOPPED`.

## Runtime boundary

- `ProductionAgentRuntime.run()` enters the lifecycle before admission and leaves it in `finally`.
- `beginDrain()` moves lifecycle to `DRAINING` and closes admission.
- Admission close rejects queued waiters with `RUN_DRAINING`, removes them from the queue, and cleans timeout/abort listeners.
- New runs are rejected while draining.
- Already admitted active runs are allowed to finish naturally.
- `drain()` resolves only after all runs that entered before draining have left the lifecycle.

## Current limitation

Running cancellation is not end-to-end yet. A drain deadline must not be described as safe forced cancellation until AbortSignal propagates through Agent Loop, LLM providers, and tools.

## Next step

Add process/server adapters (SIGTERM and HTTP stop-accepting) around the runtime lifecycle, then add bounded drain deadlines once running cancellation is implemented.
