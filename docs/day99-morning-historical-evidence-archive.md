# Day 99 morning — Historical evidence archive authorization (2026-11-28)

## Existing boundaries
- Day 98 `classifyDay98InflightEffect` and `reviewDay98InflightReleaseBoundary` classify fixture observations without trust, mutation, resend or release authority.
- `SQLiteRecoveryRemoteReceiptFinalizer.finalize` rechecks original actor's current ACL even for terminal replay, and couples receipt consumption, Command/Control CAS, Effect and Outbox writes. Do not relax that check or reuse its write path for archival.
- `RecoveryRemoteAppliedReceipt.source` is a literal, not authentication. The existing adapter interface has no production implementation.

## New contract (design only)
Separate historical attribution (original actor and immutable intent) from present authorization (authenticated archiver principal, tenant, scoped grant, current revision). New operation `archive_historical_evidence` is a proposed separate permission, not an existing RecoveryOperation. Archive is append-only evidence storage, never a terminal state transition. Authoritative frozen intent is read server-side, not accepted as proof from request JSON.

Bind tenant, run, original actor, deployment/release/attempt, barrier/resource, provider, command/effect/idempotency key, command digest, original fence, and receipt/evidence ID, canonical payload digest, provenance and verification metadata. Do not store raw credentials or unnecessary provider data. Keep candidate observations in an isolated lab namespace; never set authenticated_server_adapter or promote candidate trust.

## Transaction contract
Authenticate caller at ingress; isolate lab identity injection from production. Resolve frozen intent and current archive permission inside the same transaction domain. Verify current tenant/run ownership, actor grant, scoped operation and expected grant revision, including on replay. Validate binding and size/schema. Read evidence identity by tenant/provider/evidence ID. Exact same canonical evidence and binding returns prior archive ID without new insertion. Same identity but changed binding or digest is a conflict; preserve original, reject overwrite, record conflict separately through an authorized audit path. Distinct conflicting evidence IDs can be retained as candidates but must not resolve the outcome automatically. Atomically append evidence and archive audit event. If authority is external or unavailable, no production write; a second read alone is insufficient.

Archive never updates the original Command, Effect Ledger, Control, fencing state, receipt-consumption table or dispatch Outbox. Return `observationTrusted=false`, `automaticResend=false`, `publishAuthorized=false` in the lab. Record archive writer separately from original actor. Read/replay requires its own current permission; a historical archive ID is not a bearer token.

## Noon acceptance plan
Extend the current Recovery Runtime with a SQLite isolated archive lab, reusing Day 98 types/classifier. Seed frozen intent and archive grant in the same DB; simulate original actor revoked, currently authorized archiver, wrong tenant/run or operation, revoked archive grant on replay, tampered identity, exact replay, digest collision/conflict (same ID different bytes), two connections, atomic failure and restart. Assert no changes to existing business tables/dispatch, no trust escalation. No real provider calls. Production remains NO_GO.

## Evening plan
Read-only archive diagnostics compose with Day 98 release boundary; missing or conflicting archive remains a blocker, archived candidates do not clear prior blockers. Resource journal and provider authentication remain future work.
