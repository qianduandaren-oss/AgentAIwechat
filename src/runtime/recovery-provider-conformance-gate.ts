import {
  reviewRecoveryProviderCandidate,
  type RecoveryProviderCandidateRequest,
  type RecoveryProviderProfileRegistry
} from "./recovery-provider-candidate-review.js";

/**
 * Day 71 EVENING: fail-closed evidence review, NOT a dispatch authorizer.
 * This module never calls a provider, sends an effect, or mutates the Ledger.
 * All registry methods MUST be backed by a trusted server-side authority.
 */
export type RecoveryProviderContractViolation =
  | "duplicate_effect"
  | "stale_epoch_accepted"
  | "false_final_negative"
  | "receipt_identity_mismatch"
  | "idempotency_retention_broken";

export interface RecoveryProviderProbeEvidence {
  providerId: string;
  source: "trusted_server_test_harness" | "unverified";
  /** Revision of the trusted capability profile evaluated by this probe. */
  profileRevision: number;
  testedAtEpochMs: number;
  result: "passed" | "failed" | "inconclusive";
  /** These must be verified by a real downstream integration test in production. */
  observed: {
    sameKeyDeduplicatedAtSink: boolean;
    staleEpochRejectedAtSink: boolean;
    authoritativeFinalQuery: boolean;
    receiptBoundToEffect: boolean;
    noLateCommitAfterFinalNegative: boolean;
    effectScopedKey: boolean;
    retentionCoversRecoveryWindow: boolean;
  };
}

/**
 * An operational violation must remain quarantined even after a later green
 * test. Only a separate, privileged incident resolution may clear it.
 * This interface does not implement durable incident storage or approvals.
 */
export interface RecoveryProviderConformanceRegistry
  extends RecoveryProviderProfileRegistry {
  getCurrentProfileRevision(providerId: string): number | undefined;
  getLatestProbe(providerId: string): RecoveryProviderProbeEvidence | undefined;
  getUnresolvedViolations(providerId: string): readonly RecoveryProviderContractViolation[];
}

export type RecoveryProviderConformanceBlocker =
  | "static_candidate_denied"
  | "authority_unavailable"
  | "invalid_review_clock"
  | "unresolved_contract_violation"
  | "missing_or_invalid_profile_revision"
  | "missing_or_untrusted_probe"
  | "probe_identity_or_revision_mismatch"
  | "probe_expired_or_from_future"
  | "probe_not_passed"
  | "declared_guarantee_not_observed";

export interface RecoveryProviderConformanceReview {
  /** Even a true candidate is NOT an execution permission. */
  candidate: boolean;
  staticCandidate: boolean;
  blockers: RecoveryProviderConformanceBlocker[];
  /** Never turn an UNKNOWN into an automatic resend. */
  automaticUnknownResend: false;
}

function positiveSafeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * Composes Day 71 noon's phase-aware static candidate with CURRENT server-owned
 * conformance evidence. This is an additional review gate, not a substitute
 * for actual sink-side atomicity, ACL, current epoch, or receipt persistence.
 */
export function reviewRecoveryProviderConformance(
  registry: RecoveryProviderConformanceRegistry,
  request: RecoveryProviderCandidateRequest,
  nowEpochMs: number,
  maxProbeAgeMs: number
): RecoveryProviderConformanceReview {
  const denied = (blockers: RecoveryProviderConformanceBlocker[],
    staticCandidate = false): RecoveryProviderConformanceReview => ({
    candidate: false, staticCandidate, blockers: [...new Set(blockers)],
    automaticUnknownResend: false
  });

  // A registry outage is a denial, not a reason to skip the conformance gate.
  try {
    const base = reviewRecoveryProviderCandidate(registry, request);
    const blockers: RecoveryProviderConformanceBlocker[] = [];
    if (!base.candidate) blockers.push("static_candidate_denied");
    if (!positiveSafeInt(nowEpochMs) || !positiveSafeInt(maxProbeAgeMs)) {
      blockers.push("invalid_review_clock");
    }

    const profile = registry.getVerifiedProfile(request.providerId);
    const revision = registry.getCurrentProfileRevision(request.providerId);
    const probe = registry.getLatestProbe(request.providerId);
    const incidents = registry.getUnresolvedViolations(request.providerId);
    if (incidents.length !== 0) blockers.push("unresolved_contract_violation");
    if (!positiveSafeInt(revision)) {
      blockers.push("missing_or_invalid_profile_revision");
    }
    if (!probe || probe.source !== "trusted_server_test_harness") {
      blockers.push("missing_or_untrusted_probe");
    }
    if (probe && (probe.providerId !== request.providerId ||
      !positiveSafeInt(revision) || probe.profileRevision !== revision)) {
      blockers.push("probe_identity_or_revision_mismatch");
    }
    if (probe && (!positiveSafeInt(probe.testedAtEpochMs) ||
      !positiveSafeInt(nowEpochMs) || !positiveSafeInt(maxProbeAgeMs) ||
      probe.testedAtEpochMs > nowEpochMs ||
      nowEpochMs - probe.testedAtEpochMs > maxProbeAgeMs)) {
      blockers.push("probe_expired_or_from_future");
    }
    if (probe && probe.result !== "passed") blockers.push("probe_not_passed");

    if (profile && probe) {
      const c = profile.capabilities;
      const o = probe.observed;
      // Audit EVERY guarantee advertised in the CURRENT profile, not merely
      // the single operation being requested. Drift quarantines the provider.
      const mismatch =
        (c.atomicIdempotency && (!o.sameKeyDeduplicatedAtSink ||
          (profile.idempotencyScope === "effect" && !o.effectScopedKey) ||
          !o.retentionCoversRecoveryWindow)) ||
        (c.epochFencing && !o.staleEpochRejectedAtSink) ||
        (c.statusQuery === "authoritative_final" && !o.authoritativeFinalQuery) ||
        (profile.stableReceiptIdentity && !o.receiptBoundToEffect) ||
        (profile.finalNegativeNoLateCommit && !o.noLateCommitAfterFinalNegative);
      if (mismatch) blockers.push("declared_guarantee_not_observed");
    }

    if (blockers.length !== 0) return denied(blockers, base.candidate);
    return {
      candidate: base.candidate, staticCandidate: base.candidate,
      blockers: [], automaticUnknownResend: false
    };
  } catch {
    return denied(["authority_unavailable"]);
  }
}
