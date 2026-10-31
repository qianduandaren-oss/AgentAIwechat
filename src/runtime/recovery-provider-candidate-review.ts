import {
  auditRecoveryProviderCapabilities,
  type RecoveryProviderCapabilityAudit,
  type RecoveryProviderCapabilityProfile
} from "./recovery-provider-capability-contract.js";
import type { RecoveryEffectLedgerStatus } from "./recovery-external-effect-ledger.js";

/**
 * Day 71 NOON: server-side provider capability / durable-effect phase review.
 * This function NEVER issues a fence, performs a provider request, changes an
 * effect ledger, or grants operator authorization. Profiles and effect status
 * must be read from trusted SERVER sources, never request JSON.
 */
export interface RecoveryProviderProfileRegistry {
  getVerifiedProfile(providerId: string): RecoveryProviderCapabilityProfile | undefined;
}

export type RecoveryProviderReviewOperation =
  | "first_dispatch"
  | "reconcile_unknown_applied"
  | "fresh_claim_after_final_negative"
  | "automatic_unknown_resend";

export interface RecoveryProviderCandidateRequest {
  providerId: string;
  operation: RecoveryProviderReviewOperation;
  /** Durable Ledger state, obtained from a trusted server-side store. */
  effectStatus: RecoveryEffectLedgerStatus;
  /** Must cover the maximum delayed recovery horizon, not just HTTP timeout. */
  recoveryWindowSeconds: number;
}

export type RecoveryProviderReviewBlocker =
  | "provider_not_verified"
  | "effect_phase_mismatch"
  | "capabilities_insufficient"
  | "automatic_unknown_resend_forbidden"
  | "unsupported_operation";

export interface RecoveryProviderCandidateReview {
  /** Only an architectural CANDIDATE, never permission to send a tool call. */
  candidate: boolean;
  operation: RecoveryProviderReviewOperation;
  blockers: RecoveryProviderReviewBlocker[];
  audit: RecoveryProviderCapabilityAudit;
}

const knownOperations: readonly RecoveryProviderReviewOperation[] = [
  "first_dispatch",
  "reconcile_unknown_applied",
  "fresh_claim_after_final_negative",
  "automatic_unknown_resend"
];

function validId(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 && value.length <= 256;
}

/**
 * Fail closed on unknown provider, wrong ledger phase or unsafe capability.
 * In particular a status=UNKNOWN effect can never be submitted as a
 * first_dispatch by relabeling the requested operation.
 *
 * Fresh-claim and reconciliation candidacy still require a CURRENT trusted
 * provider observation, auth/CAS/Fence checks, and transactional persistence.
 */
export function reviewRecoveryProviderCandidate(
  registry: RecoveryProviderProfileRegistry,
  request: RecoveryProviderCandidateRequest
): RecoveryProviderCandidateReview {
  const blockers: RecoveryProviderReviewBlocker[] = [];
  const profile = validId(request.providerId)
    ? registry.getVerifiedProfile(request.providerId)
    : undefined;
  const verified = Boolean(profile && profile.providerId === request.providerId &&
    profile.source === "verified_server_adapter");
  if (!verified) blockers.push("provider_not_verified");
  const audit = auditRecoveryProviderCapabilities(
    verified ? profile : undefined, request.recoveryWindowSeconds
  );

  const phaseExpected = request.operation === "first_dispatch"
    ? "pending"
    : "unknown";
  if (!knownOperations.includes(request.operation)) {
    blockers.push("unsupported_operation");
  } else if (request.effectStatus !== phaseExpected) {
    blockers.push("effect_phase_mismatch");
  }

  let capabilitiesCandidate = false;
  switch (request.operation) {
    case "first_dispatch":
      capabilitiesCandidate = audit.firstDispatchCandidate;
      break;
    case "reconcile_unknown_applied":
      capabilitiesCandidate = audit.appliedReconciliationCandidate;
      break;
    case "fresh_claim_after_final_negative":
      capabilitiesCandidate = audit.finalNegativeFreshClaimCandidate;
      break;
    case "automatic_unknown_resend":
      blockers.push("automatic_unknown_resend_forbidden");
      break;
    default:
      blockers.push("unsupported_operation");
  }
  if (request.operation !== "automatic_unknown_resend" && !capabilitiesCandidate) {
    blockers.push("capabilities_insufficient");
  }

  return {
    operation: request.operation,
    candidate: blockers.length === 0 && capabilitiesCandidate,
    blockers: [...new Set(blockers)],
    audit
  };
}
