# Day 70 morning · External effect fencing is not a SQLite lock

Date: 2026-10-30 (Asia/Shanghai)

## Context from Days 67–69

- Shared SQLite Command Claim allows one owner per commandId, not one effect across every downstream system.
- Run-level Control CAS prevents stale writes to a Run.
- Day 69's same-SQLite grant/ACL/tenant revisions are checked at Claim and Finalizer.
- The old RecoveryOperationService can still bypass the candidate route; the official HTTP/CLI Recovery ingress and real identity/ACL authority are not wired.

The next risk: an external tool call or message send may occur **between** Claim and Finalizer, or an Outbox publisher may perform a side effect then crash before marking the row dispatched. An SQLite rollback cannot undo that side effect.

## Desired producer/consumer protocol (not implemented yet)

1. Recover using durable Command / Control / Outbox facts; do not execute a second effect on unknown outcomes.
2. For each effect, derive an immutable effectId + idempotencyKey tied to commandId and operation. Persist the intent and claim its dispatch ownership.
3. Obtain an epoch / fence from the *trusted* ownership+authorization authority. Check the current authorization and ownership again immediately before side effect; a preflight read alone is not atomic.
4. The effect sink must check **current** epoch and idempotency key atomically with applying the side effect (or guarantee equivalent provider-side idempotency).
5. If the sink cannot enforce this, treat timeout/lost response as **unknown**, reconcile with provider evidence, and stop retrying rather than claim exactly-once.
6. Retain stable ResultSnapshot and immutable audit correlation; revoke/reassign epochs monotonically, never replay an old epoch's mutation.

```text
claimAuthorized → executing v2 → prepare
                                    ↓
                            persist effect intent
                                    ↓
                          authority issues fence
                                    ↓
                           external effect sink
                validate current epoch + dedupe key atomically
                         ├─ applied / already_applied
                         ├─ stale epoch → reject
                         └─ timeout → UNKNOWN / reconcile
                                    ↓
                terminal Finalizer (same SQLite boundary)
```

## Actual scope today

Added `src/runtime/recovery-external-effect-fence.ts` with:
- `RecoveryExternalEffectIntent`, `RecoveryExternalEffectFence`;
- strict, pure `assertRecoveryExternalEffectFenceBinding` for command, actor, tenant, owner, effectId, dedupe key, revisions and positive epoch;
- future ports `RecoveryExternalEffectAuthority` and `FencedRecoveryExternalEffectSink`.

Added `src/demos/day70-morning-external-effect-fence-test.ts`: eight binding-only assertions. No provider called. This does NOT prove fresh epoch, issuance authenticity, revocation at dispatch, sink atomicity or exactly-once. These assertions cannot replace the provider's current-epoch and idempotency checks.

Local command after `npm ci`:
`npm run test:recovery-external-effect-fence`.

## Acceptance criteria for next sessions

- Day 70 noon: implement a small same-SQLite effect-intent ledger + monotonic epoch in a trusted local authority; simulate two dispatchers racing and an old epoch; explicitly model unknown outcomes.
- Day 70 evening: test retry-after-provider-commit/lost-response and disabled/unsupported sink capabilities, summarize Week 10 and release blockers.
- No direct Legacy fallback, no API tokens in repository, no production flag.
- Any third-party sink lacking atomic dedupe or fencing needs reconciliation or human review; adding an idempotencyKey header alone is not a guarantee.

## Release decision

**NO_GO**. The pure contract is not a production fence. Real authentication/ACL authority, official HTTP/CLI, legacy bypass isolation, external effect sink guarantees, multi-process acceptance, and cutover playbook remain missing.
