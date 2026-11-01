# Day 72 noon — persist trusted applied receipt without terminal transition

Date: 2026-11-01 (Asia/Shanghai). Week 11 / Day 72.

## Continuing the SAME Runtime

Day 70 created the same-file Effect Intent Ledger and UNKNOWN; Day 71 added Provider capability and conformance review; Day 72 morning defined read-only receipt identity review. The noon exercise adds transactionally durable evidence into the EXISTING SQLiteRecoveryExternalEffectLedger. It does not create a new sending service or pretend a third-party provider has been authenticated.

## Transaction candidate

Authenticated server-owned Provider Adapter (future) → externally authenticated applied observation → candidate review → BEGIN IMMEDIATE on SAME SQLite file → reload immutable Intent; require UNKNOWN and matching epoch; reload executing v2 Command, owner, tenant/Run permission and ACL revision; reject conflicting local mock sink receipt; re-run receipt/conformance review against the ledger state loaded within the transaction; enforce UNIQUE(provider_id,receipt_id), UNIQUE(effect_id) and UNIQUE(provider_id,idempotency_key); INSERT immutable authenticated observation; COMMIT.

No terminal Command/Control/Outbox write, no automatic retransmission, and no conversion of UNKNOWN into pending. The receipt is a separate persisted FACT, not proof of external exactly-once delivery. Duplicate trusted observations (including new observation timestamp) preserve the FIRST persisted observation. A conflicting receipt ID or Effect rebind is a conflict.

Important gap: the Provider Conformance Registry is an external synchronous server-owned dependency, not part of the SQLite transaction authority. Its profile or incidents could change after review without a shared transactional version. This candidate does NOT solve that cross-system race; production needs an authority-consistent snapshot or a more restrictive integration protocol. The literal "authenticated_server_adapter" is not authentication and must never come from user JSON.

An important regression guard blocks reconcileAgainstSameSQLiteSink() when a remote receipt already exists. Absence of the local MOCK receipt must not turn a remotely applied UNKNOWN effect into pending.

## Verification

Run npm ci && npm run test:recovery-remote-receipt-persistence.

17 real SQLite scenarios: first insert evidence only, two connections competing, conflicting receipt reused for another Effect, second receipt for same Effect, idempotent observation refresh, stale epoch, wrong ledger state, ACL revoke, Run ACL drift, provider profile drift, open incident, forged receipt source, authority outage, process restart, prevent local-sink negative overwrite, missing Command, and mixed local/remote proof domains.

## Next

Evening should review recovery after receipt storage: current grant revocation, Control terminal CAS and evidence audit. Do not mark succeeded merely because receipt is stored. Real IAM, authenticated Provider Adapter, authority-consistent Registry, official HTTP/CLI, Legacy bypass isolation, and production multi-process fault tests remain NO_GO.
