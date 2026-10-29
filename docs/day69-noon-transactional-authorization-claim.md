# Day 69 noon · Transactional ACL revision check inside Command Claim

Date: 2026-10-29 (Asia/Shanghai)

## What changed

The morning lesson introduced only `RecoveryAuthorizationEvidence` and a desired
`TransactionalAuthorizedRecoveryClaimer`. This noon exercise implements a
**candidate local-SQLite authority** inside the existing
`SQLiteRecoveryFinalizationUnitOfWork`:

- Three authority tables: Run tenant/ACL revisions, actor grants, Run-specific
  operation grants. A trusted administrative writer updates them.
- `claimAuthorized(request, owner, evidence)` validates evidence/command identity
  and compares authoritative revisions and active grants **after BEGIN IMMEDIATE
  and before inserting a Command**.
- The original shared Claim logic still performs owner/identity checks, accepted
  v1 -> executing v2 CAS, in-flight suspension and durable terminal replay.
- `RecoveryAuthorizationEvidenceConflictError` becomes sanitized HTTP 409
  `RECOVERY_CONFLICT`, never an internal SQL message.
- The test reuses `RecoveryIngressGate -> ClaimRequiredRecoveryEntry ->
  SQLiteRecoveryFinalizationUnitOfWork` with request-bound trusted evidence.
  It simulates a revocation after the ingress policy's allow decision but before
  Claim to prove there is **zero Command/Control/Outbox** at that boundary.

## Real SQLite cases

`npm run test:recovery-authorized-claim`

1. Fresh revisions allow a single accepted v1 -> executing v2; duplicate suspends.
2. Separate connection commits actor grant revoke/version change.
3. Separate connection commits Run ACL version change.
4. Separate connection commits Run tenant version change.
5. Run moves to a different tenant.
6. Actor grant revoked even if the revision is incorrectly left unchanged.
7. Run-specific permission revoked.
8. Actor grant row missing.
9. Evidence actor does not match request identity.
10. An already in-flight Command cannot replay after grant revocation.
11. Existing Day 67/68 candidate ingress chain: simulated permission change
    between policy allow and Claim yields a sanitized conflict and zero admission.

## Boundaries and non-goals

**This is not a production ACL provider.** The new authority tables are
test-owned local data, not automatically synchronized from real HR/IAM/IdP
permissions. SQLite can only atomically protect values stored in its own
transaction. An external authorization service cannot be protected by this
SQLite lock; a second stale read or a cached revision is not a fencing protocol.

**Raw Claim is still callable.** `claim()` continues to support existing
Day 67 compatibility tests; it does not enforce this ACL gate. A production
composition root must prevent bypass routes, ensure trusted principal and
evidence creation, and supply an authorized claim boundary on *every* write
and replay path. This exercise does not switch the official HTTP/CLI route.

**Execution is not fully atomic.** There is still a gap between Command Claim
and downstream actions; revocation after Claim would need an explicit
execution-time policy/fencing design. The Legacy service can still execute
independent writes on old paths.

Atomic Recovery release decision: **NO_GO**.
