# Day 65 noon — Same-database Recovery admission, claim and replay

Date: 2026-10-25 (Asia/Shanghai). **Status: CANDIDATE ONLY / Atomic cutover NO_GO.**

## Contract and ownership

The new opt-in `AtomicRecoveryControlOnlyAdapter` never invokes the old
`RecoveryOperationService.execute()` or `DurableRecoveryOperationOrchestrator`.
Selection of the legacy route, if any, MUST be made by the caller BEFORE
starting an atomic attempt, never in the atomic adapter's error handler.

`SQLiteRecoveryFinalizationUnitOfWork.admitControlOnlyCommand()` uses its
existing SQLite connection and `BEGIN IMMEDIATE` to inspect the durable
command identity. Only an absent command may be admitted. It inserts
`accepted v1` and claims `executing v2` using version+status CAS in the
same SQLite transaction. Concurrent callers of the same command id see
`executing` and suspend, or a terminal snapshot and replay; mismatched
immutable fields are rejected.

The separate opt-in adapter then:

1. Reads the durable Command, route-decision and same-DB admission.
2. Reads Checkpoint + Control, runs authorization and **pure** Prepare.
3. Calls the existing Selective Finalizer with expected Command v2,
   version-guarded Checkpoint/Control writes, terminal CAS and deterministic
   Outbox entry in **one SQLite transaction**.
4. Returns the durable terminal record, not an in-memory draft.
   A retry after COMMIT/response loss replays only the durable ResultSnapshot.

This route is limited to quarantine, release_quarantine and dead_letter.
Resume/retry_recovery still require the Coordinator and are explicitly
unsupported by the atomic adapter.

## Commands

```bash
npm ci
npm run build
node dist/demos/day65-atomic-route-decision-test.js
node dist/demos/day65-atomic-control-only-integration-test.js
npm run test:selective-recovery-unit-of-work
npm run test:durable-recovery-operation
```

The Day 65 noon test uses real SQLite files and two independent connections,
covering disabled flag, unsupported operation, admission/terminal CAS,
commit-reply loss and replay, immutable identity conflicts, in-flight
suspension, authorization denial, no-op, and a concurrent duplicate command.
The Runtime Tests workflow includes this new test after Build.

## Non-claims and release blockers

- The official HTTP/worker entry point **has not been rewired**. Legacy
  Service and Orchestrator remain unchanged; their independent writes are
  not safe to mix with the new adapter.
- An executing Command left after a failed Finalizer or process crash is
  **suspended**, not automatically re-executed. Durable reconciliation
  and operator policy are not yet implemented.
- The authorization provider must not perform external side effects;
  the Outbox publisher is still outside this SQLite transaction.
- All production entry-point faults (especially COMMIT vs response loss),
  cross-process recovery, single-terminal-writer ownership, and explicit
  feature-flag cutover review remain mandatory.
- Candidate tests passing does **not** authorize cutover.
