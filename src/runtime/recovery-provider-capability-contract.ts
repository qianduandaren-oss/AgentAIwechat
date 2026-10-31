import type { RecoveryRemoteProviderCapabilities } from "./recovery-external-effect-reconciliation.js";

/**
 * Day 71 MORNING: capability AUDIT only, not an effect dispatcher.
 * The profile must be constructed by a trusted server-side integration;
 * the source field is metadata, NOT cryptographic evidence.
 */
export interface RecoveryProviderCapabilityProfile {
  providerId: string;
  source: "verified_server_adapter" | "unverified" | "client_claim";
  capabilities: RecoveryRemoteProviderCapabilities;
  /** Whether a receipt identifies the same command/effect/idempotency key. */
  stableReceiptIdentity: boolean;
  /** A final negative lookup guarantees that an older request cannot commit later. */
  finalNegativeNoLateCommit: boolean;
  /** Scope of the provider's atomic deduplication key, not the caller's key format. */
  idempotencyScope: "effect" | "other" | "unknown";
  /** Provider-guaranteed minimum dedupe retention, in seconds. */
  idempotencyRetentionSeconds: number | null;
}

export type RecoveryProviderCapabilityBlocker =
  | "untrusted_capability_source"
  | "invalid_provider_identity"
  | "no_downstream_atomic_protection"
  | "status_query_not_authoritative"
  | "receipt_identity_not_verifiable"
  | "negative_result_not_final"
  | "atomic_idempotency_not_supported"
  | "idempotency_scope_not_effect"
  | "idempotency_retention_insufficient"
  | "invalid_recovery_window";

export interface RecoveryProviderCapabilityAudit {
  /** Architectural candidate only; DOES NOT authorize a real tool call. */
  firstDispatchCandidate: boolean;
  /** May query trusted final status; receipt must still be checked and persisted. */
  appliedReconciliationCandidate: boolean;
  /** Not retry permission: must recheck current ACL, epoch, Command and Ledger. */
  finalNegativeFreshClaimCandidate: boolean;
  /** UNKNOWN is never blindly retried based on static capabilities. */
  automaticUnknownResend: false;
  blockers: RecoveryProviderCapabilityBlocker[];
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Fail-closed STATIC review. The adapter's credentials, real finality contract,
 * freshness, and authorization must be verified separately at the effect sink.
 */
export function auditRecoveryProviderCapabilities(
  profile: RecoveryProviderCapabilityProfile | undefined,
  recoveryWindowSeconds: number
): RecoveryProviderCapabilityAudit {
  const blockers: RecoveryProviderCapabilityBlocker[] = [];
  const validWindow = validPositiveInteger(recoveryWindowSeconds);
  if (!validWindow) blockers.push("invalid_recovery_window");
  const trusted = profile?.source === "verified_server_adapter";
  if (!trusted) blockers.push("untrusted_capability_source");
  if (!nonempty(profile?.providerId)) blockers.push("invalid_provider_identity");

  const c = profile?.capabilities;
  const atomic = c?.atomicIdempotency === true;
  const epoch = c?.epochFencing === true;
  if (!atomic && !epoch) blockers.push("no_downstream_atomic_protection");

  const queryFinal = c?.statusQuery === "authoritative_final";
  if (!queryFinal) blockers.push("status_query_not_authoritative");
  if (profile?.stableReceiptIdentity !== true) blockers.push("receipt_identity_not_verifiable");
  if (profile?.finalNegativeNoLateCommit !== true) blockers.push("negative_result_not_final");
  if (!atomic) blockers.push("atomic_idempotency_not_supported");
  if (profile?.idempotencyScope !== "effect") blockers.push("idempotency_scope_not_effect");
  if (!validWindow || !validPositiveInteger(profile?.idempotencyRetentionSeconds) ||
      profile.idempotencyRetentionSeconds < recoveryWindowSeconds) {
    blockers.push("idempotency_retention_insufficient");
  }

  const validSource = trusted && nonempty(profile?.providerId) && validWindow;
  const firstDispatchCandidate = validSource && (atomic || epoch);
  const appliedReconciliationCandidate = validSource && queryFinal &&
    profile?.stableReceiptIdentity === true;
  const finalNegativeFreshClaimCandidate = appliedReconciliationCandidate &&
    profile?.finalNegativeNoLateCommit === true && atomic &&
    profile?.idempotencyScope === "effect" &&
    validPositiveInteger(profile?.idempotencyRetentionSeconds) &&
    profile.idempotencyRetentionSeconds >= recoveryWindowSeconds;

  return {
    firstDispatchCandidate,
    appliedReconciliationCandidate,
    finalNegativeFreshClaimCandidate,
    automaticUnknownResend: false,
    blockers
  };
}
