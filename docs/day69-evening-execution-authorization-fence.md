# Day 69 evening · Finalizer rechecks authorization after Claim

Date: 2026-10-29 (Asia/Shanghai)

## Why an additional fence is necessary

Day 69 morning defined trusted Authorization Evidence and immutable revisions.
Noon used the same SQLite ACL tables and transaction to reject stale grants
**before Command Admission**. The next gap is AFTER a successful Claim but
BEFORE committing Control / Command terminal / Outbox.

This exercise gives new `same_sqlite`-fenced Command records a durable
`authorizationFence` marker. The shared Claimer returns the trusted evidence
only to the `claimed_executing` execution path. The Atomic Control-only
Adapter carries it into the SQLite Finalizer.

## Actual atomic boundary

- `claimAuthorized()`: BEGIN IMMEDIATE → verify current ACL + versions →
  accepted v1 → executing v2 COMMIT.
- Pure Prepare / authorizer: occurs outside SQLite; cannot take a cross-service lock.
- `commit()`: BEGIN IMMEDIATE → read persisted Command marker → REQUIRED
  evidence → verify Run tenant, Run ACL, actor grant, Run-level operation
  permission and three revisions → Checkpoint compare → Control CAS →
  terminal Command CAS → Outbox INSERT → COMMIT.
- Any stale evidence or missing required evidence ROLLBACKs all Finalizer
  state changes. Command remains executing v2, requiring durable fact inspection.
  DO NOT blindly retry or send it to Legacy.
- Direct legacy/unfenced commands retain existing behavior for backwards
  compatibility. This is NOT a global enforcement of all Recovery operations.

## Regression

Run: `npm run test:recovery-authorization-finalize-fence`.

Eight real SQLite scenarios cover successful fenced finalization, post-Claim
grant revoke, Run ACL drift, tenant migration, Run-specific permission revoke
without revision bump, missing evidence, revocation during the async
business-authorizer call, and replay denial after a previously valid COMMIT.
Failures must leave Control absent, Outbox 0, Command executing v2, Checkpoint
v1; no successful terminal or legacy fallback may be fabricated.

## Release decision: NO_GO

This proves a **same SQLite authority** check at the Control-only terminal
write boundary. It does NOT prove atomic authorization of an external IAM/ACL,
nor prevent side effects that happen before Finalizer or by Legacy service.
The source of authenticated Principal and ACL evidence, direct raw
`claim()` / `execute()` bypasses, external tool effects, HTTP/CLI transport,
and multi-process cutover are still pending. If an external effect happens
between Claim and Finalizer it needs its own fencing or reconciler.
