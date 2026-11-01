# Day 72 morning · Trusted remote receipt is not a terminal transition

Date: 2026-11-01 (Asia/Shanghai). Week 11 / Day 72.

## Continuing the same Runtime

- Day 70: Effect Intent, leased Epoch, UNKNOWN state, and read-only remote reconciliation.
- Day 71: provider capability matrix and conformance evidence (simulated tests).
- Day 72 morning: remote applied receipt identity and trust boundary, before any future SQLite persistence.

An ACK-loss response must never be interpreted as a failure or permission to retry. A provider reporting applied also does not authorize an immediate Command terminal transition: the response can be stale, belong to another effect, come from an untrusted source, or race with a newer lease/ACL revocation.

## Proposed receipt path

Trusted server adapter -> authenticated authoritative provider query -> complete receipt evidence -> provider conformance review -> immutable identity/epoch/profile revision review -> PERSISTENCE REQUIRED ONLY.

Future same-SQLite persistence needs BEGIN IMMEDIATE: re-read UNKNOWN Ledger and Epoch; re-check command owner/tenant/ACL revisions; enforce UNIQUE(provider_id,receipt_id) plus unique per effect/key as appropriate; store the authenticated observation and provenance durably; reject rebindings and racey status changes; only later finalize Command/Control/Outbox through separate existing CAS/authorization constraints. A unique receipt row is NOT proof that an external effect was exactly-once.

This morning intentionally adds only src/runtime/recovery-remote-receipt-review.ts and a strict typed future adapter interface. It reuses Day 70 planUnknownRemoteEffectRecovery() and Day 71 reviewRecoveryProviderConformance(). It performs no network requests or SQLite writes and does not modify any existing execution entry.

The source marker authenticated_server_adapter and TypeScript types do not authenticate anything. Real adapters must independently authenticate provider responses and securely bind provider-supplied identifiers, using trusted server-side request records, NEVER client JSON. Today only simulated test fixtures construct receipt objects. The conformance Registry itself still requires reliable server persistence and protected authority to be production-ready.

## Acceptance

Run:

npm ci
npm run test:recovery-remote-receipt-review
npm run test:recovery-provider-conformance
npm run test:recovery-effect-reconciliation

25 contract checks: valid applied receipt, missing/untrusted/empty receipt, provider/command/run/actor/tenant/owner/operation/effect/key/epoch mismatch, profile revision drift, stale/future observation, wrong Ledger phase/epoch, stale fence, unresolved provider incident and authority outage. All reviews are read-only.

## Follow-up for noon and evening

Noon: introduce same-file trusted receipt persistence with unique keys and immutable binding; test two SQLite connections racing to persist duplicate or conflicting receipt. Evening: review revocation before receipt storage, terminal CAS, lost ACK and NO_GO release blockers. Do not invent remote provider exactly-once or auto retry.

Current release: NO_GO (no real receipt adapter, production IAM/ACL, HTTP/CLI, Legacy isolation, atomic Intent/Outbox or fault-injection acceptance).
