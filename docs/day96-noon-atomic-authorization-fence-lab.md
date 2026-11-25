# Day 96 noon — Atomic authorization and resource fence (isolated NO_GO)

Follow the Day 96 morning design and Day 95 read-only release boundary.
This is a synthetic same-SQLite transaction-domain experiment. The Day 95
review is unchanged; no candidate HOLD can produce real release authorization.

- Controller initializes an immutable-for-attempt candidate policy containing
  deployment/release/attempt/resource, epoch/digest/key status and validity,
  checkpoint sequence/event hash, evidence digest/deadline. Digests are fixture
  inputs, not authenticated facts. It compares the entire normalized snapshot
  in BEGIN IMMEDIATE; one issue per resource/attempt, exact request replay only.
- Issue reserves the next resource-specific safe-integer fence, advances floor
  and persists the exact request. Revocation CAS increments epoch and floor
  together and deactivates the key. This lab does not reopen or rotate attempts.
- Consume looks up the persisted issuance, compares scope, principal, operation,
  digest and fence, then current resource floor, policy and time window in the
  same transaction as dummy effect and receipt. A matching historical replay
  returns the old receipt even after revocation, with no new effect.
- Lock errors and simulated effect failure throw; the caller must not authorize
  from exceptions. A trigger abort after receipt update demonstrates rollback.
  The second connection and reopen tests operate only on disposable SQLite.

Run `npm ci` then `npm run test:recovery-writer-atomic-authorization-fence`.
The test covers stale-before-issue, stale-before-new-effect, competing requests,
lock contention, cross-binding, expiry, interrupted transaction, restart and
exact replay. No actual production credentials, services, network or writes.
A shared writable DB or rollback of the entire file can defeat this lab; a real
resource must enforce its own current trusted floor and authenticated principal,
and external side effects require resource-native conditional execution.
The synthetic clock and principal are not trusted production inputs.
All outcomes have publishAuthorized=false.
