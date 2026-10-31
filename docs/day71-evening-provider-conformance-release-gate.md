# Day 71 evening · Provider contract drift, lost ACK and release gate

Date: 2026-10-31 (Asia/Shanghai) · Week 11 / Day 71

## Why this follows morning and noon

- Morning: audited what a provider **claims** (atomic idempotency, downstream epoch fencing, authoritative final query, receipts, retention).
- Noon: composed the claims with the trusted Effect Ledger phase to produce architectural candidates; UNKNOWN was never auto-resendable.
- Evening: compared declared guarantees with **observed test evidence**, fail-closed on stale/untrusted evidence, and held an unresolved violation in quarantine even after another green check.

The new `src/runtime/recovery-provider-conformance-gate.ts` calls the existing `reviewRecoveryProviderCandidate()`. It does not replace that code, rewrite Day 70's Ledger, call any external provider, issue epochs, or persist business state.

## Evidence interface and trust boundary

`RecoveryProviderConformanceRegistry` supplies a verified profile, current profile revision, latest probe and **unresolved incidents**. All four must be owned by the server. The caller must **not** supply these fields through HTTP JSON.

A candidate is blocked when: static phase/capabilities fail; registry is unavailable; the provider probe is absent, untrusted, failed or inconclusive; provider/profile revision does not match; evidence is from the future or expired; a declared guarantee was not observed; or an unresolved contract violation exists.

The `source: "trusted_server_test_harness"` marker is not an attestation or cryptographic proof. The `profileRevision` number is only a version binding; a real system must use authenticated, durable registries, protected probe storage and an incident-resolution process. Today's tests use in-memory simulated profiles/probes, **not production provider acceptance tests**. The source code deliberately does not claim incident persistence or automatic rollback.

## Example: provider advertises atomic idempotency, but duplicate effect occurs

```text
Provider A capability profile = strong, v1
  -> Day 71 noon: first_dispatch candidate
  -> simulated external probe: same key applied twice
  -> reported observed.sameKeyDeduplicatedAtSink = false
  -> conformance: declared_guarantee_not_observed
  -> first dispatch + UNKNOWN recovery candidates DENIED

Later green probe, but unresolved duplicate_effect incident
  -> quarantine persists at policy boundary
  -> privileged incident resolution required before re-assessment
```

A genuine network ACK loss does NOT by itself prove the provider broke its contract. The remote effect may have succeeded. Continue to use Day 70's `planUnknownRemoteEffectRecovery()`: without trusted observation, stay UNKNOWN/manual; with a bound applied receipt, plan **receipt persistence**, not a direct terminal transition; with a non-final negative, no fresh claim.

## Test and acceptance

```bash
npm ci
npm run test:recovery-provider-conformance
npm run test:recovery-provider-matrix
npm run test:recovery-effect-reconciliation
```

34 new regression assertions: four capability profiles, missing/stale/revision-mismatched evidence, untrusted/failed probes, each broken advertised guarantee, unresolved violations surviving later green probes, registry failures, phase bypass, forged client fields ignored by trusted registry, and lost-ACK UNKNOWN planning.

Release verdict: **NO_GO**. Current evidence is simulated. Before real cutover, require provider-hosted fault-injection and semantic validation, durable incident quarantine, trusted ACL and Run owner, production HTTP/CLI ingress, old Legacy bypass isolation, external receipt persistence, transactional Outbox/Intent integration, and multi-process crash/recovery verification. Even after those, avoid asserting generic cross-system exactly-once without explicit downstream atomic guarantees.

Next (Day 72): trustworthy remote receipt persistence and its relation to Command/Effect terminal state, building on Day 70 UNKNOWN policy.
