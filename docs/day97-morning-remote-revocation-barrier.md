# Day 97 morning — Remote revocation confirmation barrier (design, NO_GO)

## Starting point

Day 96's SQLiteDay96AtomicAuthorizationLab puts revocation and the resource
floor in the same transaction. reviewDay96AtomicReleaseBoundary is read-only
and never calls the lab's mutating methods. In separate transaction domains
a local policy change cannot atomically advance the remote floor.

## Contract

- Freeze the authoritative resource inventory for deployment/release/attempt;
  pin its digest, revision and the expected target identities. The persistent
  fence namespace is deployment/resource, not attempt; attempt binds the
  revocation request but must not reset the resource counter.
- The controller transaction disables old issuance, creates a unique
  barrierId, pins policy epoch/digest, target floor per resource, and the
  inventory digest, and persists per-target durable delivery records. State:
  revocation_pending. It does not claim remote revocation is complete.
- Each target must authenticate the controller, reject wrong bindings,
  persist a monotonically increasing floor using its own write transaction
  and record an idempotent receipt for the exact barrier command in that
  same transaction. All protected mutations compare their fence and
  capability authorization inside that same serialization domain.
  No stale effect can commit after that target's floor installation.
  This does not undo earlier effects or protect out-of-transaction effects.
- An exact duplicate may return the historical receipt; a reused command
  ID with a different request digest is a conflict. A lower floor must never
  overwrite a higher one. A newer floor does not by itself acknowledge a
  different barrier. Historical receipt is not proof of current head.
- Controller verifies the target's authenticated identity, barrierId,
  deployment/release/attempt, resourceId, manifest digest, policy epoch/digest,
  target floor, command digest and durable receipt. For a live release it
  must also establish current non-rollback floor and freshness (e.g. a fresh
  challenge response from an independently trusted resource). Caller labels
  and HTTP success do not establish these facts.
- Only an exact complete authoritative inventory of verified current evidence,
  no conflicts, and a CAS against the current barrier/inventory/policy can
  mark revocation_confirmed. New policy/inventory supersedes the old barrier;
  delayed ACKs cannot satisfy a new one. Timeout, partition, missing or
  contradictory evidence remains pending or HOLD; never turn missing ACK into
  success. This is not consensus, a global atomic transaction or release authority.

## Ordering cases

| Case | Expected |
| --- | --- |
| Old command commits before destination floor update | May have committed; reconcile by durable command/receipt; do not undo by assertion |
| Old command arrives after destination floor update | Reject in destination transaction |
| Destination commits floor, ACK lost | Keep pending; exact retry returns same historical receipt; verify live head separately |
| A confirms, B partitioned | Entire barrier remains pending |
| Stale ACK for superseded barrier | Do not count toward current barrier |
| Reboot | Floor and receipt survive; rollback remains an explicit threat |

## Noon plan

Two temporary SQLite files, one controller and one simulated destination
domain; independent transactions and injected lost responses. Multiple
resource IDs in destination for the coverage test. Reuse existing durable
command/outbox and idempotency concepts, preserve Day 96 and its test paths.
Exercise before/after ordering, lost ACK, exact retry, conflicting replay,
wrong barrier/resource, partial coverage, restart and no-production intent.
Even complete synthetic coverage stays publishAuthorized=false. No real
network identity, independent anti-rollback store, Host OS/FD evidence or
Consumer ACK is implied. Evening will compose read-only diagnostics, not
promote fixture evidence.
