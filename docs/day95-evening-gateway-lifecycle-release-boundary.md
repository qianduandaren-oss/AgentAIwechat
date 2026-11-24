# Day 95 evening — Lifecycle-aware release boundary (isolated NO_GO)

Reuse Day 93 inventory/audit/source review and Day 95 lifecycle review (which already
calls Day 94 pinned gateway verifier). Do not run a second, weaker gateway check.
The composite uses Promise.allSettled to preserve independent branch diagnostics.
A signature verified under a previous policy is not current authorization.
No source authenticity, atomic cross-source snapshot, or final policy CAS is established.

Run `npm run test:recovery-writer-audit-gateway-lifecycle-release-boundary`.
Fixtures use temporary SQLite and ephemeral Ed25519 keys. Tests cover one gateway query
with two policy reads, synthetic host and ACK evidence, revocation race, revoked key,
policy rollback, wrong key after rotation, missing audit, reader failure, stale policy
reader, and production early refusal. A stale reader returning the same old policy twice
can appear consistent while actual policy is revoked; this is a negative counterexample.

Next: independent policy authority and conditional authorization at the effect boundary:
compare exact policy epoch/digest and checkpoint, check revocation and evidence freshness,
consume an attempt-bound capability atomically, enforce fencing at the resource.
No production authorization is implemented here.
