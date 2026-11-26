# Day 97 noon — Remote revocation barrier lab (NO_GO)

Two separate temporary SQLite files, not a distributed transaction. Controller
persists a frozen synthetic inventory, policy epoch, per-target command and
pending state together. It records an issuance-stopped flag but does not own a
real issuing service. The resource's floor + historical ACK commit together;
old dummy grants are seeded only for the exercise. Resource fence namespace is
deployment/resource, not attempt. A newer barrier must preserve the synthetic
inventory and advance every target floor. The controller requires exact current
barrier ACK coverage plus matching observed heads before fixture confirmation.

Run `npm run test:recovery-writer-remote-revocation-barrier`. The regression
covers partial coverage, lost response, restart, transaction rollback, old
effects before/after installation, duplicate receipts, mismatched heads,
superseded ACKs, and attempt changes. Old effects committed before installation
are not undone; exact replay reads the prior result without a new effect.
The in-process observations can be forged or stale; no transport identity,
signed challenge, real issuer integration, rollback resistance, or live
cross-domain CAS is provided. No production authority; all results keep
publishAuthorized=false. Keep Day 96's same-domain lab intact.
