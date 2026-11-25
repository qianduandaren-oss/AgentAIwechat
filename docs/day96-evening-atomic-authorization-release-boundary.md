# Day 96 evening — Atomic authorization lab and release boundary

The Day 95 reviewer remains read-only and HOLD. Day 96 noon is a same-SQLite
transaction-domain lab. The new reviewer accepts explicitly untrusted lab
observations, validates scope and the single-effect fixture counts, preserves
all Day 95 blockers, and never calls the lab's mutating methods. A dummy effect
or historical replay is not release authority.

Run `npm run test:recovery-writer-atomic-authorization-release-boundary`.
Tests cover an absent observation, revoke-before-effect with fence=1/floor=2,
valid dummy effect, replay after revocation, scope and count mismatch, fabricated
positive observation, lifecycle race, missing audit reader and production early
denial. The previous noon test covers transaction rollback and reopening.
The next step is a remote-resource contract: idempotency + conditional fencing
at the destination, durable delivery and reconciliation of uncertain outcomes.
No real identity, protected remote effect, external monotonic trust root or
authenticated Host/Consumer evidence is implied. Production NO_GO.
