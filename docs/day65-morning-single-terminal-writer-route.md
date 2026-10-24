# Day 65 morning — atomic Recovery route admission contract

Date: 2026-10-25 (Asia/Shanghai). Status: **ADDITIVE ONLY / NO_GO**.

## What is real in main

Day 64 added a pure Control-only Prepare and a selective SQLite Finalizer. Old
`RecoveryOperationService.execute()` still calls `controlStore.save()`
outside Finalizer. The existing
`DurableRecoveryOperationOrchestrator.acceptAndExecute()` still writes
terminal Command records after `executor.execute()`. Calling them from a
nominally new atomic path would violate the single-writer requirement.

## New component and its limits

`src/runtime/recovery-atomic-route-decision.ts` adds a pure admission
*decision* for a future feature-gated adapter. When disabled, it returns
`legacy_unchanged` without touching existing behavior. When enabled:

1. Only `quarantine`, `release_quarantine`, `dead_letter` are eligible.
2. An existing `commandId` is checked against the full immutable identity
   via `decideDurableRecoveryOperation` before any replay or suspension.
3. `succeeded / rejected / failed` replay only a persisted ResultSnapshot;
   missing snapshots fail closed.
4. `accepted / executing` always suspend for reconciliation; no blind redo.
5. A new command returns `admit_new_control_only`: this is NOT an accepted or
   executing durable record yet.
6. Unsupported atomic operations fail closed. No fallback to the old handler
   is permitted after a new-path failure.

This selector has **no** Store, UoW, network, audit or tool dependencies and is
**NOT CONNECTED TO THE PRODUCTION ENTRY POINT**. Its unit tests establish
routing decisions, not the correctness of an end-to-end transaction.

## Required before live wiring

- Implement insert-if-absent and accepted→executing CAS with the **same**
  durable Command store used by the SQLite Finalizer (single physical DB).
- Verify authorization, load current facts, then use Day 64 pure Prepare.
- Pass its Write Set to Finalizer; do not invoke legacy Service or its
  independent `controlStore.save()` anywhere on the new route.
- Finalizer alone owns terminal CAS plus Outbox; the Orchestrator must not
  perform a second terminal write on this route.
- Persist ResultSnapshot for every terminal status, including rejected and
  failed; handle lost COMMIT response by identity-verified durable reload.
- Add real-route SQLite crash/error injection, concurrent duplicate commands,
  immutable identity conflicts, and external tool idempotency checks.
- Run same-commit Build, existing Recovery regression and full new-route E2E.
  Keep release flag OFF until independent review.

## Verify decision contract

```bash
npm run build
node dist/demos/day65-atomic-route-decision-test.js
```

**Gate: NO_GO** — pure admission contract is not a deployed route.
