# Day 98 morning — post-revocation in-flight effect reconciliation

2026-11-27 · Week 14 · isolated review only · production NO_GO

## Boundary

Day 97's barrier reports caller-supplied aggregate old-effect counts; these are not a complete per-command ledger and must never authorize release. A revocation ACK proves neither absence of previous effects nor finality of in-flight operations. Compare commit and fence-install order at the same resource's durable serialization boundary, not controller timestamps, response arrival order, or different resources' sequence counters.

Reuse:
- `src/runtime/recovery-external-effect-ledger.ts`: pending / leased / unknown / committed.
- `src/runtime/recovery-external-effect-reconciliation.ts`: `planUnknownRemoteEffectRecovery` is advisory, and requires authoritative final observations, identity binding and no-late-commit guarantee plus retry safety for negative results.
- `src/runtime/recovery-remote-receipt-review.ts`: review an applied receipt for persistence, not authorization.
- `src/runtime/recovery-remote-receipt-finalizer.ts`: existing local terminal transaction rechecks current ACL; a revoked original grant must not be revived to finalize the business command. Preserve separately authorized historical evidence.
- `src/runtime/recovery-writer-remote-revocation-release-boundary.ts`: preserve existing blockers, trust=false and publishAuthorized=false.

## Proposed diagnostic contract (not implemented yet)

Freeze candidate in-flight intent inventory when stopping dispatch. Bind deployment, release, attempt, barrier, resource, provider, command, effect, idempotency key, original fence and command digest. Ledger effect epoch, policy epoch, resource fencing floor and resource journal ordinal have distinct meanings. Never equate them.

For each candidate intent:
- Bound applied receipt and same-resource commit ordinal strictly before install ordinal: historical applied; no resend. Persist evidence under separate currently authorized evidence path.
- Bound final non-applied observation with no-late-commit guarantee (e.g. fenced rejection of the exact request plus durable final absence): final non-applied; no automatic retry; new intent needs current authorization and duplicate protection.
- Applied at/after install with old fence, conflicting receipt, or mismatched identity: invariant violation / HOLD; investigate bypass, never normalize as ordinary pre-revocation success.
- Missing receipt, timeout, eventual-consistency absence, unproven ordering or incomplete inventory: unresolved / HOLD. If applied but ordering is unknown, preserve that fact without inventing a time classification.

A negative response to a second attempt alone cannot prove the first attempt did not commit. ACK and effect receipt are independent. Reconciliation cannot itself dispatch, compensate, advance floor, consume capability, finalize terminal state or clear existing production blockers.

## Noon plan and acceptance

Implement a read-only classifier beside Day 97, using isolated fixture identities and resource-local ordered observations. Keep the existing unknown recovery policy for eventual provider integration; do not pass synthetic observations as authenticated provider facts. Test commit-before-install with delayed ACK, final rejected exact operation, timeout/no receipt, late commit under obsolete fence, duplicate/conflicting identity and unordered observations. Preserve original effect identity across retries; require independently authorized compensation.

Evening: compose diagnostics with Day 97 review, preserve blockers and produce Week 14 checkpoint. Candidate complete inventory is not independent evidence. No production execution.

## Regression maintenance

Day 97 evening CI run 45796644579 failed Build (TS2345 at line 220 in day97-evening-remote-revocation-release-boundary-test.ts). The throw-only getter for scope was inferred as void. Day 98 morning explicitly annotates the getter with Day97BarrierObservation["scope"], preserving the production-path non-access assertion. Recheck CI before claiming a green build.
