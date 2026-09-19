# Day 29 Noon — Run Admission Controller

Day 29 introduces a bounded run-level admission boundary before ProductionAgentRuntime execution.

Implemented in `src/runtime/run-admission-controller.ts`:

- `maxConcurrentRuns`
- `maxQueuedRuns`
- FIFO waiting queue
- explicit `RunOverloadedError`
- idempotent release handles
- runtime snapshot for active/queued counts

A runnable test lives at `src/demos/run-admission-controller-test.ts` and can be executed with:

```bash
npm run test:run-admission
```

The controller itself is complete and tested by source-level integration code. Wiring it into `ProductionAgentRuntime.run()` is intentionally pending because the GitHub connector blocked the attempted large replacement of `production-runtime.ts`; the next course run should retry that integration before adding queue timeout or cancellation.
