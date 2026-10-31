# Day 71 morning · Provider Capability Contract and truthfulness gate

Date: 2026-10-31 (Asia/Shanghai) · Week 11 / Day 71

## Why this follows Day 70

Day 70 introduced a same-SQLite Effect Intent Ledger with monotonic epochs and a **read-only** remote UNKNOWN reconciliation planner. The remote provider has not been integrated. Today's task is to classify an external system's actual guarantees before building a remote adapter.

The new `src/runtime/recovery-provider-capability-contract.ts` provides a conservative static capability audit. It is **not** the authoritative provider adapter, not proof that provider documentation is accurate, and not dispatch permission. The `source` property must be set by trusted server-side integration code; no request JSON may supply or override it.

## Separate the capabilities instead of using one supportsRetry boolean

| Property | Meaning | Required for |
| --- | --- | --- |
| atomicIdempotency | Sink atomically deduplicates the effect and key | Safe recovery from repeated delivery, subject to retention/scope |
| epochFencing | Sink rejects superseded execution epochs with the actual effect write | Stale worker protection (not same-epoch dedup by itself) |
| statusQuery: authoritative_final | Provider query is a trustworthy final status, not an eventually consistent read | Resolving applied vs UNKNOWN |
| stableReceiptIdentity | A returned receipt binds commandId, effectId and idempotencyKey | Trustworthy applied evidence |
| finalNegativeNoLateCommit | A final negative response guarantees the old request will not later commit | Considering a new claim after verified non-execution |
| idempotencyScope=effect | Key uniqueness has the required effect scope | Recovery without cross-effect aliasing |
| idempotencyRetentionSeconds >= recoveryWindowSeconds | Provider's dedupe window spans the planned recovery horizon | Safe dedup coverage for delayed retry/dispatch |

## Three candidate answers, not production permissions

- `firstDispatchCandidate`: the *architecture* has at least an atomic idempotency or sink-enforced epoch feature. This does not prove its implementation or authorize a tool.
- `appliedReconciliationCandidate`: an authoritative final query and stable, bound receipt are available. Observation authenticity must still be verified by the trusted adapter before persistence.
- `finalNegativeFreshClaimCandidate`: additionally requires a final negative with no late commit, atomic idempotency, proper key scope, and sufficient retention. The result is **not** automatic retry permission; recheck ACL, ownership, version, epoch and Ledger.
- `automaticUnknownResend`: always `false`. An UNKNOWN remains frozen without trustworthy provider facts.

This audit is fail-closed on untrusted sources, missing IDs, unsafe retention or unknown capabilities. Capability profiles must be reviewed against provider contracts and ideally validated in an integration environment.

## Run the contract regression

```bash
npm ci
npm run test:recovery-provider-capabilities
npm run test:recovery-effect-reconciliation
```

The 15 new TypeScript assertions check strong/weak/untrusted profiles, stale queries, nonfinal negative queries, key scope, retention window, and the unconditional prohibition against blind UNKNOWN resend.

## Week 11 release gate

**NO_GO.** Still missing: authenticated provider adapters, real receipts and authority checks, transactionally persisted remote receipts, production Outbox/Intent wiring, safe cutoff of old unguarded Recovery write paths, real IAM/tenant authority, distributed fault injection and the cutover review.

Next: Day 71 noon exercises this profile against a matrix of four simulated external providers, without sending any real tool request.
