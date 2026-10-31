import {
  reviewRecoveryProviderCandidate,
  type RecoveryProviderProfileRegistry,
  type RecoveryProviderReviewOperation
} from "../runtime/recovery-provider-candidate-review.js";
import type { RecoveryProviderCapabilityProfile } from "../runtime/recovery-provider-capability-contract.js";
import {
  planUnknownRemoteEffectRecovery,
  type RecoveryRemoteProviderObservation
} from "../runtime/recovery-external-effect-reconciliation.js";
import type {
  RecoveryExternalEffectIntent,
  RecoveryExternalEffectFence
} from "../runtime/recovery-external-effect-fence.js";

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error("Day 71 noon: " + label);
}
let passed = 0;
function expect(label: string, ok: boolean): void {
  check(ok, label);
  passed++;
}

const strong: RecoveryProviderCapabilityProfile = {
  providerId: "provider-a",
  source: "verified_server_adapter",
  capabilities: {
    statusQuery: "authoritative_final",
    atomicIdempotency: true,
    epochFencing: true
  },
  stableReceiptIdentity: true,
  finalNegativeNoLateCommit: true,
  idempotencyScope: "effect",
  idempotencyRetentionSeconds: 7200
};
const bare: RecoveryProviderCapabilityProfile = {
  ...strong, providerId: "provider-b",
  capabilities: { statusQuery: "none", atomicIdempotency: false, epochFencing: false },
  stableReceiptIdentity: false, finalNegativeNoLateCommit: false,
  idempotencyScope: "unknown", idempotencyRetentionSeconds: null
};
const epochOnly: RecoveryProviderCapabilityProfile = {
  ...bare, providerId: "provider-c",
  capabilities: { ...bare.capabilities, epochFencing: true }
};
const delayedQuery: RecoveryProviderCapabilityProfile = {
  ...strong, providerId: "provider-d",
  capabilities: {
    statusQuery: "eventually_consistent",
    atomicIdempotency: true,
    epochFencing: false
  }
};
const profiles = new Map([strong, bare, epochOnly, delayedQuery].map(x => [x.providerId, x]));
const registry: RecoveryProviderProfileRegistry = {
  getVerifiedProfile: id => profiles.get(id)
};
const operations: RecoveryProviderReviewOperation[] = [
  "first_dispatch",
  "reconcile_unknown_applied",
  "fresh_claim_after_final_negative",
  "automatic_unknown_resend"
];
const matrix: Array<[string, boolean[]]> = [
  ["provider-a", [true, true, true, false]],
  ["provider-b", [false, false, false, false]],
  ["provider-c", [true, false, false, false]],
  ["provider-d", [true, false, false, false]]
];

// 16 checks: candidate != permission, in particular UNKNOWN never auto resends.
for (const [providerId, expected] of matrix) {
  for (let i = 0; i < operations.length; i++) {
    const result = reviewRecoveryProviderCandidate(registry, {
      providerId, operation: operations[i],
      effectStatus: i === 0 ? "pending" : "unknown",
      recoveryWindowSeconds: 3600
    });
    expect(providerId + " / " + operations[i], result.candidate === expected[i]);
  }
}
const review = (providerId: string, operation: RecoveryProviderReviewOperation,
  effectStatus: "pending" | "unknown" = "unknown",
  recoveryWindowSeconds = 3600) =>
  reviewRecoveryProviderCandidate(registry,
    { providerId, operation, effectStatus, recoveryWindowSeconds });

// Fail closed even if a client sends a stronger profile in JSON.
// This registry ignores request fields and can only fetch server-owned profiles.
const forged = {
  providerId: "provider-b", operation: "reconcile_unknown_applied" as const,
  effectStatus: "unknown" as const, recoveryWindowSeconds: 3600,
  capabilities: strong.capabilities,
  source: "verified_server_adapter"
};
expect("17. client-supplied extra capability fields are ignored",
  !reviewRecoveryProviderCandidate(registry, forged).candidate);
expect("18. missing provider denied",
  !review("provider-unknown", "first_dispatch", "pending").candidate);
const mismatchRegistry: RecoveryProviderProfileRegistry = {
  getVerifiedProfile: () => strong
};
expect("19. registry profile ID mismatch denied",
  !reviewRecoveryProviderCandidate(mismatchRegistry, {
    providerId: "provider-b", operation: "first_dispatch",
    effectStatus: "pending", recoveryWindowSeconds: 3600
  }).candidate);
expect("20. cannot relabel UNKNOWN as first dispatch",
  !review("provider-a", "first_dispatch", "unknown").candidate);
expect("21. cannot reconcile a still-pending effect",
  !review("provider-a", "reconcile_unknown_applied", "pending").candidate);
expect("22. too-short idempotency retention blocks fresh claim",
  !review("provider-a", "fresh_claim_after_final_negative", "unknown", 86400).candidate);
profiles.set("provider-a", { ...strong, finalNegativeNoLateCommit: false });
expect("23. absence of no-late-commit guarantee blocks new claim",
  !review("provider-a", "fresh_claim_after_final_negative").candidate);
profiles.set("provider-a", strong);
expect("24. invalid operation fails closed",
  !reviewRecoveryProviderCandidate(registry, {
    providerId: "provider-a", operation: "unsupported" as RecoveryProviderReviewOperation,
    effectStatus: "unknown", recoveryWindowSeconds: 3600
  }).candidate);
expect("25. untrusted source denied even when flags are strong",
  !reviewRecoveryProviderCandidate({
    getVerifiedProfile: () => ({ ...strong, source: "client_claim" })
  }, {
    providerId: "provider-a", operation: "first_dispatch",
    effectStatus: "pending", recoveryWindowSeconds: 3600
  }).candidate);

// Reuse Day 70's PURE reconciliation planner. Nothing is dispatched or written.
const command = {
  commandId: "cmd-day71-noon", runId: "run-day71-noon",
  requestedBy: "operator-a", operation: "quarantine" as const,
  reason: "lost provider acknowledgement",
  expectedCheckpointVersion: 1, expectedControlVersion: 0
};
const evidence = {
  actorId: "operator-a", tenantId: "tenant-a", runId: command.runId,
  operation: command.operation, allowed: true,
  revisions: { runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9 }
};
const intent: RecoveryExternalEffectIntent = {
  command, owner: "atomic_control_only",
  effectId: "effect-day71-noon", idempotencyKey: "effect-day71-noon:key",
  authorizationEvidence: evidence
};
const fence: RecoveryExternalEffectFence = {
  commandId: command.commandId, runId: command.runId,
  actorId: "operator-a", tenantId: "tenant-a",
  owner: intent.owner, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, epoch: 1,
  authorizationRevisions: evidence.revisions
};
const applied: RecoveryRemoteProviderObservation = {
  kind: "applied", commandId: command.commandId, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, receiptId: "receipt-provider-a"
};
const negative: RecoveryRemoteProviderObservation = {
  kind: "not_applied", commandId: command.commandId, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, noLateCommitGuarantee: true
};
const ledgerView = { status: "unknown" as const, epoch: 1 };
expect("26. A applied result is only a receipt-persistence recommendation",
  review("provider-a", "reconcile_unknown_applied").candidate &&
  planUnknownRemoteEffectRecovery(intent, fence, ledgerView,
    strong.capabilities, applied).action ===
      "verified_applied_requires_receipt_persistence");
expect("27. A final-negative result is only a fresh-claim assessment",
  review("provider-a", "fresh_claim_after_final_negative").candidate &&
  planUnknownRemoteEffectRecovery(intent, fence, ledgerView,
    strong.capabilities, negative).action ===
      "verified_not_applied_requires_fresh_authorized_claim");
expect("28. D delayed provider query is not final",
  !review("provider-d", "reconcile_unknown_applied").candidate &&
  planUnknownRemoteEffectRecovery(intent, fence, ledgerView,
    delayedQuery.capabilities, applied).action === "manual_review_required");

check(passed === 28, "all 28 checks completed");
console.log("Day 71 noon: 28/28 provider profile matrix + fail-closed reviews passed.");
console.log("No real provider requests, persistence writes, or UNKNOWN auto retry.");
