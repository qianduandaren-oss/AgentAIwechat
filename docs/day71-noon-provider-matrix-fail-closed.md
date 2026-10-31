# Day 71 noon · Provider matrix and fail-closed candidate routing

Date: 2026-10-31 (Asia/Shanghai) · Week 11 / Day 71

## What was added

`src/runtime/recovery-provider-candidate-review.ts` composes Day 71's existing static `auditRecoveryProviderCapabilities` with the Day 70 durable Effect Ledger **phase**, obtained from a trusted server-side store. It does not invoke a provider, issue an epoch, change a ledger, or give permission to execute. Use `RecoveryProviderProfileRegistry` as a server-owned integration dependency: never construct it from HTTP JSON. Do not trust `source: "verified_server_adapter"` as cryptographic attestation.

| Simulated profile | First dispatch candidate (pending only) | Applied lookup candidate (UNKNOWN) | Final-negative fresh claim candidate (UNKNOWN) | Blind UNKNOWN resend |
| --- | --- | --- | --- | --- |
| A: verified atomic idempotency, epoch, authoritative final query, bound receipt, sufficient retention and no-late-commit | yes | yes | yes, **not permission to resend** | NEVER |
| B: plain send API, no atomic guarantee/query | no | no | no | NEVER |
| C: sink-enforced epoch only, no final query | yes (first only) | no | no | NEVER |
| D: atomic idempotency, eventually consistent query | yes (first only) | no | no | NEVER |

**Security boundary:** `first_dispatch` requires durable status `pending`; `reconcile_unknown_applied` and `fresh_claim_after_final_negative` require `unknown`. A caller cannot declare UNKNOWN as a new first dispatch to bypass safety. These are still advisory reviews: the real server must also verify Principal, current Run/ACL, owner and lease, actual provider receipt, and a trusted atomic downstream effect protocol.

## Exercise

```bash
npm ci
npm run test:recovery-provider-matrix
npm run test:recovery-provider-capabilities
npm run test:recovery-effect-reconciliation
```

The 28 new assertions cover a 4-provider × 4-action truth table, forged capability fields, unknown/mismatched provider, invalid action, wrong effect phase, insufficient retention, no-late-commit, untrusted profile, and composition with Day 70 read-only reconciliation for applied/negative/stale observations.

## Important unsolved problems

Static declared capability ≠ provider's real, tested promise. A negative observation must be verified and final. Even an A-type provider does not permit automatic UNKNOWN resend. No real HTTP adapter, external IAM/ACL, provider receipt persistence, Outbox-Intent atomic integration, or Legacy path closure has been implemented. **Release: NO_GO.**

Next: Day 71 evening, test false capability promises, lost ACK and release checklist without calling a real external provider.
