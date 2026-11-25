# Day 96 morning — Atomic authorization and resource fencing (isolated lab only)

Date: 2026-11-25. Follow Day 95 lifecycle release boundary. The existing
reviewDay95LifecycleReleaseBoundary is read-only and unconditionally returns
publishAuthorized=false. Its permanent blockers include missing atomic policy
authorization and missing trusted external evidence. Do not bypass them.

## Proposed lab contract (not a runtime API yet)

- A controller compares the exact current policy epoch and canonical policy
  digest, active key and cumulative revocation status, checkpoint sequence and
  event hash, immutable deployment/release/attempt and resource identifiers,
  evidence digest/freshness and attempt state, within a serialized transaction.
  The digest is not a substitute for authenticated evidence. A request cannot
  choose its own trusted baseline or token.
- A successful *isolated simulation* reserves one attempt-bound capability with
  a strictly increasing resource-scoped fencing token, expiry, operation and
  command digest; the request ID and full binding are retained for exact replay.
  The fence is a separate monotonic domain from policy epoch and audit sequence.
  No production capability or real release effect can be issued from Day 95 fixtures.
- The protected resource compares the capability's scope, operation, digest,
  expiry, issuance record, current policy and minimum valid fence at effect
  commit; it consumes the capability and performs a dummy effect in one transaction.
  Exact replay returns the stored receipt, different content with the same ID is
  a conflict. A new issuance or revocation advances the resource minimum in this
  lab; stale tokens cannot commit, even if the old process wakes up before the
  new worker writes. For a multi-service system the floor must reach the resource
  through a trusted, ordered protocol, or it must reject while freshness is unknown.
- A separate controller issuance transaction cannot make an external HTTP call,
  raw file write or remote side effect atomic. Use a resource-native conditional
  mutation or transactional inbox/outbox and idempotent sink with its own fence.
  Never hold a local transaction and claim that it also protects remote effects.

## Noon lab acceptance targets

Use disposable SQLite, not deployment storage. Model policy, resource fence,
attempt/capability and dummy effect/receipt in the same transaction boundary;
use BEGIN IMMEDIATE with no awaited network call inside the transaction.
Validate revocation between review and issue, revocation between issue and use,
two competing claims, stale worker before any new effect, wrong scope or command,
expiry, exact replay, rollback on interrupted effect, restart, and production refusal.
Use safe integer checks and fail closed on exhaustion. Real external control-plane
identity, trusted durable evidence, anti-rollback storage, host/FD isolation and
consumer enforcement are not established by this simulation.

## Evening integration target

Keep Day 95 review diagnostics and NO_GO unchanged. Exercise the proposed
authority/resource protocol with synthetic isolated inputs, demonstrate why
checking a fence only at the caller or comparing only the largest *seen* token
does not prevent all stale writes. No production wiring.
