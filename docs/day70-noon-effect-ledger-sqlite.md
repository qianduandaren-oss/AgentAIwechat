# Day 70 noon · SQLite effect intent ledger and monotonic local fence epochs

Date: 2026-10-30 (Asia/Shanghai)

## Why this exists

Day 69's same-file ACL fences protect Recovery Command Claim and the final Control-only Finalizer. They do not roll back an external tool that executes between those transactions. Day 70 morning defined the effect identity and fence types. Noon adds a *candidate local simulation* to make duplicate dispatch, stale-worker epochs and UNKNOWN outcomes testable.

## New runtime module

src/runtime/recovery-external-effect-ledger.ts adds SQLiteRecoveryExternalEffectLedger and two tables on the same test database file as Day 69's Recovery Command and local ACL authority:

- recovery_effect_intents: one immutable effectId and globally unique idempotencyKey, current status, durable epoch and dispatcher identity.
- recovery_effect_sink_receipts: one atomic, durable simulated sink receipt per idempotency key.

The ledger's states are:

~~~text
pending -> leased(epoch+1) -> committed

leased -> unknown -> reconcileAgainstSameSQLiteSink:
- trusted local receipt exists -> committed, do not redispatch
- trusted local receipt missing -> pending, then a new Claim increments epoch
~~~

UNKNOWN never means "failed". A losing concurrent dispatcher gets in_flight, not a fence. Both Claim and local simulated sink check current same-file ACL authority, the persisted executing v2 Command, route owner, immutable identity and grant/Run revisions. The mock sink compares the latest epoch and idempotency key **inside the same SQLite transaction that inserts a fake effect receipt**.

## Reproduce

~~~bash
npm ci
npm run test:recovery-effect-ledger
npm run test:recovery-external-effect-fence
npm run test:recovery-authorization-finalize-fence
~~~

src/demos/day70-noon-effect-ledger-test.ts covers 10 real-SQLite scenarios:
1. two connections, one effect lease;
2. duplicate staging vs changed immutable identity;
3. sink committed, ACK lost, UNKNOWN reconciled without resend;
4. absent local receipt, new epoch and stale token rejection;
5. atomic downstream idempotency-key deduplication;
6. revoked ACL after lease blocks simulated sink;
7. no persisted executing/fenced Command blocks effect staging;
8. UNKNOWN and epoch survive restart;
9. forged command/epoch token denied;
10. ACL revision drift before dispatch lease denied.

## Deliberate limitations and release decision

- This is an **all-local simulation**, not a real network provider or a production-grade distributed effect protocol.
- The test sink shares SQLite with the issuing authority. An external provider cannot see or atomically lock this database. Do **not** infer exactly-once semantics from these local tests.
- reconcileAgainstSameSQLiteSink must **never** be reused for a remote provider based only on a missing receipt. Remote no-answer may mean success, failure or delayed application.
- The ledger is currently a testable candidate alongside the existing Recovery Runtime; it is **not** wired into the existing Outbox Dispatcher or real HTTP/CLI ingress.
- A real effect sink requires provider-side atomic idempotency or epoch enforcement, provider query/reconciliation and a durable correlation ID. Without those capabilities: UNKNOWN, stop automatic retries and escalate for investigation.
- Initial intent staging here is a standalone candidate transaction. A production Outbox/intent must be tied to the corresponding business transition in one durable unit of work before claiming crash safety.
- Direct Legacy calls, real authentication/ACL authority, multi-process cutover and post-revocation external side-effect handling remain open.

**Atomic Recovery release decision: NO_GO.** Day 70 evening should test response-loss reconciliation and publish Week 10 / Day 64–70 Checkpoint without claiming production readiness.
