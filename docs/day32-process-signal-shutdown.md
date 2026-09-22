# Day 32 Evening — Process Signal Shutdown Adapter

The process signal layer is intentionally thin. `SIGTERM` and `SIGINT` trigger the existing `ShutdownCoordinator`; they do not own runtime lifecycle logic.

```text
SIGTERM / SIGINT
  -> ProcessSignalAdapter
  -> ShutdownCoordinator.shutdown()
  -> ServerHost.close()
  -> ProductionAgentRuntime.drain()
  -> STOPPED
```

## Rules

- Signal handlers are adapters only.
- Shutdown remains idempotent through the coordinator's cached promise.
- A successful graceful shutdown does not call `process.exit(0)`; the process can exit naturally when work and handles are complete.
- Shutdown failure sets `process.exitCode = 1` rather than immediately terminating in the middle of cleanup.
- A drain deadline / forced cancellation policy is deliberately not implemented yet because running LLM/tool cancellation is not end-to-end.

## Test

`npm run test:signal-shutdown`

The test injects a fake process host, fires SIGTERM and SIGINT, and verifies server close and runtime drain each happen once.
