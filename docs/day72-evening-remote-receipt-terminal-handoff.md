# Day 72 evening — persisted remote receipt is NOT a terminal Command

Date: 2026-11-01 (Asia/Shanghai). Week 11 / Day 72.

## Context

Day 70: Effect Intent Ledger and UNKNOWN, no automatic re-send.
Day 71: Provider Capability, Candidate, Conformance evidence.
Day 72 morning: read-only authenticated receipt review.
Day 72 noon: durable immutable remote applied receipt in the same SQLite file, WITHOUT changing Effect UNKNOWN / Command executing v2.

Evening adds a read-only *terminal-readiness* query to the EXISTING `SQLiteRecoveryExternalEffectLedger`:
`reviewRemoteReceiptTerminalReadiness(registry, { intent, fence, providerId, recoveryWindowSeconds, nowEpochMs, maxProbeAgeMs })`.

## Read-only decision

```text
Persisted applied receipt + UNKNOWN Ledger / matching epoch
         |
BEGIN IMMEDIATE (same SQLite, read-only snapshot)
  - immutable Intent and remote receipt match command/run/actor/tenant/owner/effect/key/epoch
  - reject mixed local simulation receipt
  - require existing executing v2 Command with same_sqlite authorizationFence
  - recheck CURRENT same-file run tenant, ACL revision, actor grant and run permission
  - require current Control version == command.expectedControlVersion
  - require current server-owned Provider capability revision, current passed probe, no unresolved incident
COMMIT
         |
  hold(reason) OR requires_atomic_terminal_transaction
```

The latter is only a **hint** to a future authoritative Finalizer. It is NOT permission to write a succeeded Command, committed Effect, Control CAS or Outbox. After the read-only transaction COMMITs, revocation or CAS drift may happen at once: the eventual atomic Finalizer MUST repeat all checks alongside the terminal write. Especially, the Provider Registry lives OUTSIDE SQLite; its version cannot be locked by BEGIN IMMEDIATE. Production needs authority consistency, actual authenticated Provider Adapter, and proper transactional receipt consumption.

## Verified / pending boundary

The test suite creates an authorized executing v2 Command, stages an Intent, leases epoch=1, marks UNKNOWN, and inserts the immutable remote receipt via the Day 72 noon method. The evening guard then checks held evidence on the same DB. 15 test scenarios include: valid advisory only, receipt missing, grant revoke, Run permission revoke, ACL drift, tenant drift, Control CAS drift, Command no longer executing, provider revision drift, open incident, stale conformance probe, authority outage, stale epoch, tampered receipt and two read-only connections. None moves Command terminal, sends tools, or rewrites UNKNOWN. Test: `npm run test:recovery-remote-receipt-terminal-review`.

## Production NO_GO

Unimplemented: a receipt-aware Finalizer transition under ONE local transaction, atomic receipt consumption + Control/Command/Outbox CAS, reliable external Provider authentication and downstream idempotency, authority-consistent Registry, true IAM/ACL, official HTTP/CLI ingress, Legacy bypass isolation and multi-process crash tests. No exactly-once claim.

## Next Day 73

Design receipt-consumption CAS within Finalizer, including durable replay and rollback when ACL or Control changes after the read-only review. Keep UNKNOWN frozen until a complete authorized terminal transaction is proven.
