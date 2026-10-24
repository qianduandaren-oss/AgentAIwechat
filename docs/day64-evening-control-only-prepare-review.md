# Day 64 evening — Control-only prepare / Finalizer integration review

Date: 2026-10-24 (Asia/Shanghai)
Release gate: **NO_GO** (this is an additive migration seam, not a router cutover).

## What landed

- src/runtime/recovery-control-preparation.ts: a pure Control-only preparation function for quarantine, release_quarantine, dead_letter. No Store, audit, Coordinator or tool execution is invoked. Inputs are cloned, current Checkpoint belongs only to the Read Set and never gets mutated. Invalid operation and run identity fail closed. A new Control effect records the actual command origin.
- src/demos/day64-control-preparation-test.ts: seven checks including a real SQLite Finalizer commit of the prepared quarantine effect (Checkpoint version held; Control CAS, terminal Command and Outbox written together).
- .github/workflows/runtime-tests.yml: executes the compiled test after Day 64 Selective Finalizer regression; retains existing checks.

## Migration boundary (still outstanding)

Existing RecoveryOperationService.execute() independently calls ControlStore.save() and may enter CheckpointRecoveryCoordinator. Existing DurableRecoveryOperationOrchestrator independently terminal-CASes Command on both success and failure paths. **These code paths have not been rewired by this change.** Atomic routing must not call Service.execute() or fall back to it after a partially committed Finalizer failure.

## Next acceptance requirements

1. New adapter loads current persisted Command / Checkpoint / Control and validates immutable identity. Terminal replay reads persisted ResultSnapshot; in-flight work suspends or reconciles, no blind repeat.
2. Authorization and policy checks occur before prepare; in-transaction Read Set versions and immutable Command identity are enforced by Finalizer. Control-only operation uses checkpoint=compare / control=cas_update.
3. Finalizer is the **only** terminal writer on the new route. Remove legacy terminal CAS only within the new gated path, preserving old behavior until cutover.
4. Add failure injection for versions drift, wrong outbox identity, Outbox UNIQUE, COMMIT response loss, duplicate command, external tool retry/idempotency.
5. Audit events from the new path must be committed through its Outbox. Pure preparation does not emit durable audit.
6. Verify same-commit main Build + all existing Recovery tests + new integration, and separately verify full route E2E before enabling the flag.

Do not treat the pure adapter tests, the prior Day 64 Selective Finalizer tests or a workflow PASS as proof that the actual router is already transactional.
