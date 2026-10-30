# Day 70 evening · External effect UNKNOWN reconciliation and release gate

Date: 2026-10-30 (Asia/Shanghai) · Week 10 (Day 64–70)

## Context and continuity

- Day 69: same-SQLite authorization revision fencing at Claim and Control-only Finalizer.
- Day 70 morning: external effect binding contract. Epoch/idempotency only work if the downstream authority honors them.
- Day 70 noon: same-file Effect Intent Ledger, durable epoch, UNKNOWN and simulated local Sink receipt.
- Day 70 evening: **separate remote-provider UNKNOWN handling from the local-SQLite receipt simulation**.

The new `src/runtime/recovery-external-effect-reconciliation.ts` contains a **read-only** decision function, `planUnknownRemoteEffectRecovery`. It never dispatches a tool, requeues an UNKNOWN intent, persists a result, or claims a provider is exactly-once. Its provider observation must come from a server-injected, authenticated, trusted provider adapter (still to be implemented), not from request JSON.

## Decision contract

| Current evidence | Decision | Allowed next step |
| --- | --- | --- |
| No provider query, eventual/inconsistent query, or ambiguous result | manual_review_required | Freeze automatic retry; investigate |
| Ledger not UNKNOWN, or epoch/fence mismatched | manual_review_required | Reinspect persisted authority; do not rewrite state |
| Authoritative applied receipt bound to command/effect/key | verified_applied_requires_receipt_persistence | Build a separate durable, authenticated receipt import plus fresh authorization, then reconcile |
| Authoritative final not-applied, provider guarantees no late commit, atomic idempotency or epoch fencing | verified_not_applied_requires_fresh_authorized_claim | New authorized and fenced claim may be designed; **this function never performs it** |
| Negative answer without finality or downstream protection | manual_review_required | Do not automatically retry |

The observation type is *not* a cryptographic attestation; the trust in the provider adapter and its finality semantics remains an integration obligation.

## Reproduce with real SQLite and candidate code

```bash
npm ci
npm run test:recovery-effect-reconciliation
npm run test:recovery-effect-ledger
npm run test:recovery-authorization-finalize-fence
```

The evening test `src/demos/day70-evening-effect-reconciliation-test.ts` uses a real SQLite command + ACL + Intent Ledger and a second connection. Its 15 checks cover: UNKNOWN blocks new dispatch; non-query/eventual provider cannot unblock; ambiguous/missing observation; verified applied read-only suggestion; mismatched/empty receipt; negative observation without finality; absent downstream protection; final negative candidate requiring fresh authorization; forged epoch; persisted UNKNOWN unchanged by planning; and local-SQLite applied-but-ACK-lost reconciliation with exactly one simulated receipt.

**Local and remote are deliberately separated**: the local simulated Sink may reconcile using same-file receipts. A remote provider response timeout has no equivalent database witness unless that provider exposes trustworthy status/idempotency/fencing.

## Week 10 release decision: NO_GO

Required before production rollout:

1. Authenticated HTTP/CLI Recovery ingress with authoritative tenant/Run ACL; protect replay and prevent direct untrusted Principal injection.
2. Make all Recovery write entry points pass through one authorized Claim owner; isolate legacy Service and direct unguarded Claim bypasses.
3. Production transactional intent / Outbox boundary aligned to Command and business state changes.
4. Downstream idempotency/fencing support; authenticated provider receipt/status lookup, receipt persistence, and unambiguous timeout/UNKNOWN recovery with manual intervention where necessary.
5. Multi-process/fault/restart injection under actual serving topology and documented cutover/rollback gates.
6. Explicit treatment of revocation after dispatch and an audit trail for irreversible external actions.

Neither green CI nor the read-only reconciliation planner proves production exactly-once. Keep Atomic feature flag OFF.

Week 10 summary/Checkpoint lives at `docs/checkpoints/week10-day70.md`.
