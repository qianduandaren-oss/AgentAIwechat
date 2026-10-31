import {
  auditRecoveryProviderCapabilities,
  type RecoveryProviderCapabilityProfile
} from "../runtime/recovery-provider-capability-contract.js";

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error("Day 71 morning: " + label);
}

const base: RecoveryProviderCapabilityProfile = {
  providerId: "provider-test",
  source: "verified_server_adapter",
  capabilities: {
    statusQuery: "authoritative_final",
    atomicIdempotency: true,
    epochFencing: true
  },
  stableReceiptIdentity: true,
  finalNegativeNoLateCommit: true,
  idempotencyScope: "effect",
  idempotencyRetentionSeconds: 86400
};
const audit = (p: RecoveryProviderCapabilityProfile | undefined = base, seconds = 3600) =>
  auditRecoveryProviderCapabilities(p, seconds);
let passed = 0;
function expect(label: string, ok: boolean): void {
  check(ok, label);
  passed += 1;
}

const good = audit();
expect("1. verified strong provider is only a candidate", good.firstDispatchCandidate &&
  good.appliedReconciliationCandidate && good.finalNegativeFreshClaimCandidate);
expect("2. even strong provider cannot automatically resend UNKNOWN",
  good.automaticUnknownResend === false);
expect("3. client claims cannot authorize dispatch or reconciliation",
  !audit({ ...base, source: "client_claim" }).firstDispatchCandidate &&
  !audit({ ...base, source: "client_claim" }).appliedReconciliationCandidate);
expect("4. absent capability profile fails closed", !audit(undefined).firstDispatchCandidate);
expect("5. no atomic idempotency and no epoch fencing: no dispatch candidate",
  !audit({ ...base, capabilities: { ...base.capabilities, atomicIdempotency: false, epochFencing: false } }).firstDispatchCandidate);
expect("6. epoch-only protection does not make negative retry safe",
  audit({ ...base, capabilities: { ...base.capabilities, atomicIdempotency: false } }).firstDispatchCandidate &&
  !audit({ ...base, capabilities: { ...base.capabilities, atomicIdempotency: false } }).finalNegativeFreshClaimCandidate);
expect("7. eventual query cannot verify remote completion",
  !audit({ ...base, capabilities: { ...base.capabilities, statusQuery: "eventually_consistent" } }).appliedReconciliationCandidate);
expect("8. missing stable receipt identity denies verified applied decision",
  !audit({ ...base, stableReceiptIdentity: false }).appliedReconciliationCandidate);
expect("9. no final-negative guarantee denies new claim candidate",
  !audit({ ...base, finalNegativeNoLateCommit: false }).finalNegativeFreshClaimCandidate);
expect("10. wrong atomic key scope denies safe negative retry",
  !audit({ ...base, idempotencyScope: "other" }).finalNegativeFreshClaimCandidate);
expect("11. short dedupe retention denies fresh claim candidate",
  !audit({ ...base, idempotencyRetentionSeconds: 60 }).finalNegativeFreshClaimCandidate);
expect("12. window <= retention remains candidate",
  audit({ ...base, idempotencyRetentionSeconds: 3600 }).finalNegativeFreshClaimCandidate);
expect("13. malformed provider ID cannot authorize",
  !audit({ ...base, providerId: "" }).firstDispatchCandidate);
expect("14. malformed retention cannot be treated as adequate",
  !audit({ ...base, idempotencyRetentionSeconds: Number.NaN }).finalNegativeFreshClaimCandidate);
expect("15. invalid recovery window fails closed",
  !audit(base, 0).firstDispatchCandidate && !audit(base, 0).finalNegativeFreshClaimCandidate);
check(passed === 15, "all checks executed");
console.log("Day 71 morning: 15/15 provider capability contract checks passed.");
console.log("Static capability audit never authorizes a real dispatch or an UNKNOWN resend.");
