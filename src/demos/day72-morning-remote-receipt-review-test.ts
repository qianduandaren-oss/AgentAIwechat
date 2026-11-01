import {
  reviewRemoteAppliedReceiptForPersistence,
  type RecoveryRemoteAppliedReceipt,
  type RecoveryRemoteReceiptReviewInput
} from "../runtime/recovery-remote-receipt-review.js";
import type { RecoveryProviderConformanceRegistry } from
  "../runtime/recovery-provider-conformance-gate.js";
import type { RecoveryProviderCapabilityProfile } from
  "../runtime/recovery-provider-capability-contract.js";
import type { RecoveryExternalEffectIntent } from
  "../runtime/recovery-external-effect-fence.js";
import type { RecoveryProviderProbeEvidence } from
  "../runtime/recovery-provider-conformance-gate.js";

const now = Date.UTC(2026, 10, 1, 0, 0);
const profile: RecoveryProviderCapabilityProfile = {
  providerId: "provider-a",
  source: "verified_server_adapter",
  capabilities: {
    atomicIdempotency: true,
    epochFencing: true,
    statusQuery: "authoritative_final"
  },
  stableReceiptIdentity: true,
  finalNegativeNoLateCommit: true,
  idempotencyScope: "effect",
  idempotencyRetentionSeconds: 7200
};
const probe: RecoveryProviderProbeEvidence = {
  providerId: "provider-a",
  source: "trusted_server_test_harness",
  profileRevision: 1,
  testedAtEpochMs: now - 500,
  result: "passed",
  observed: {
    sameKeyDeduplicatedAtSink: true,
    staleEpochRejectedAtSink: true,
    authoritativeFinalQuery: true,
    receiptBoundToEffect: true,
    noLateCommitAfterFinalNegative: true,
    effectScopedKey: true,
    retentionCoversRecoveryWindow: true
  }
};

let currentRevision = 1;
let unresolved = false;
let authorityFails = false;
const registry: RecoveryProviderConformanceRegistry = {
  getVerifiedProfile(id) {
    if (authorityFails) throw Error("trusted authority unavailable");
    return id === "provider-a" ? profile : undefined;
  },
  getCurrentProfileRevision() {
    return currentRevision;
  },
  getLatestProbe(id) {
    return id === "provider-a" ? probe : undefined;
  },
  getUnresolvedViolations() {
    return unresolved ? ["duplicate_effect"] : [];
  }
};

const intent: RecoveryExternalEffectIntent = {
  command: {
    commandId: "command-day72",
    runId: "run-day72",
    requestedBy: "operator-a",
    operation: "quarantine",
    reason: "remote applied receipt recovery",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  },
  owner: "atomic_control_only",
  effectId: "notify:command-day72",
  idempotencyKey: "command-day72:notify",
  authorizationEvidence: {
    actorId: "operator-a",
    tenantId: "tenant-a",
    runId: "run-day72",
    operation: "quarantine",
    allowed: true,
    revisions: {
      runTenantRevision: 3,
      runAclRevision: 5,
      actorGrantRevision: 9
    }
  }
};
const fence = {
  commandId: intent.command.commandId,
  runId: intent.command.runId,
  actorId: intent.command.requestedBy,
  tenantId: "tenant-a",
  owner: intent.owner,
  effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey,
  epoch: 1,
  authorizationRevisions: { ...intent.authorizationEvidence.revisions }
};
const receipt: RecoveryRemoteAppliedReceipt = {
  source: "authenticated_server_adapter",
  providerId: "provider-a",
  profileRevision: 1,
  receiptId: "provider-receipt-1",
  commandId: intent.command.commandId,
  runId: intent.command.runId,
  operation: intent.command.operation,
  actorId: intent.command.requestedBy,
  tenantId: "tenant-a",
  owner: intent.owner,
  effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey,
  epoch: 1,
  observedAtEpochMs: now - 10
};
const input: RecoveryRemoteReceiptReviewInput = {
  intent,
  fence,
  ledger: { status: "unknown", epoch: 1 },
  providerId: "provider-a",
  receipt,
  recoveryWindowSeconds: 3600,
  nowEpochMs: now,
  maxProbeAgeMs: 60000,
  maxObservationAgeMs: 30000
};

let passed = 0;
function expect(reason: string, value: boolean): void {
  if (!value) throw Error("Day 72 morning: " + reason);
  passed++;
}
const review = (overrides: Partial<RecoveryRemoteReceiptReviewInput> = {}) =>
  reviewRemoteAppliedReceiptForPersistence(registry, { ...input, ...overrides });
const denied = (
  reason: Extract<ReturnType<typeof review>, { action: "manual_review_required" }>["reason"],
  overrides: Partial<RecoveryRemoteReceiptReviewInput> = {}
) => {
  const result = review(overrides);
  return result.action === "manual_review_required" && result.reason === reason;
};

expect("1. authenticated matching observation produces persistence task ONLY",
  review().action === "needs_transactional_receipt_commit");
expect("2. no receipt: fail closed", denied("missing_or_untrusted_receipt", { receipt: undefined }));
expect("3. forged receipt source", denied("missing_or_untrusted_receipt",
  { receipt: { ...receipt, source: "client_claim" as RecoveryRemoteAppliedReceipt["source"] } }));
expect("4. empty receipt ID", denied("missing_or_untrusted_receipt",
  { receipt: { ...receipt, receiptId: "" } }));
expect("5. wrong provider", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, providerId: "provider-b" } }));
expect("6. wrong command", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, commandId: "other-command" } }));
expect("7. wrong run", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, runId: "other-run" } }));
expect("8. wrong actor", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, actorId: "operator-b" } }));
expect("9. wrong tenant", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, tenantId: "tenant-b" } }));
expect("10. wrong owner", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, owner: "legacy" } }));
expect("11. wrong operation", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, operation: "retry" as typeof receipt.operation } }));
expect("12. wrong effect", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, effectId: "other-effect" } }));
expect("13. wrong idempotency key", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, idempotencyKey: "other-key" } }));
expect("14. wrong epoch", denied("receipt_identity_mismatch",
  { receipt: { ...receipt, epoch: 2 } }));
expect("15. old profile revision", denied("receipt_revision_mismatch",
  { receipt: { ...receipt, profileRevision: 0 } }));
expect("16. old observation", denied("receipt_observation_stale",
  { receipt: { ...receipt, observedAtEpochMs: now - 60000 } }));
expect("17. future observation", denied("receipt_observation_stale",
  { receipt: { ...receipt, observedAtEpochMs: now + 1 } }));
expect("18. wrong ledger phase", denied("ledger_not_unknown",
  { ledger: { status: "pending", epoch: 1 } }));
expect("19. out-of-date ledger epoch", denied("ledger_not_unknown",
  { ledger: { status: "unknown", epoch: 2 } }));
expect("20. stale Fence", denied("bad_or_stale_effect_fence",
  { fence: { ...fence, actorId: "operator-b" } }));
unresolved = true;
expect("21. unresolved provider duplicate incident", denied("provider_conformance_denied"));
unresolved = false;
currentRevision = 2;
expect("22. profile revision drift", denied("provider_conformance_denied"));
currentRevision = 1;
authorityFails = true;
expect("23. authority outage", denied("authority_unavailable"));
authorityFails = false;
expect("24. no receipt review sends effects or marks terminal",
  review().action === "needs_transactional_receipt_commit" &&
  input.ledger?.status === "unknown");

expect("25. valid candidate has receipt identity for future unique constraints",
  (() => {
    const result = review();
    return result.action === "needs_transactional_receipt_commit" &&
      result.providerId === "provider-a" &&
      result.receiptId === "provider-receipt-1" &&
      result.idempotencyKey === intent.idempotencyKey &&
      result.commandId === intent.command.commandId;
  })());

if (passed !== 25) throw Error("unexpected number of Day 72 checks");
console.log("Day 72 morning: 25/25 remote receipt contract checks passed.");
console.log("NO durable receipt write, no automatic resend, no terminal update.");
