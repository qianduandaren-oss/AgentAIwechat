import type { RecoveryEffectLedgerStatus } from "./recovery-external-effect-ledger.js";
import {
  assertRecoveryExternalEffectFenceBinding,
  type RecoveryExternalEffectFence,
  type RecoveryExternalEffectIntent
} from "./recovery-external-effect-fence.js";

/**
 * Day 70 EVENING: fail-closed decision layer for an UNKNOWN remote effect.
 *
 * This is advisory and READ-ONLY. It never sends a tool request, changes the
 * ledger, or declares a remote provider exactly-once. Observations MUST be
 * obtained by an authenticated, trusted provider adapter, never request JSON.
 * The caller must persist verified receipts and re-check current ACL/epochs
 * in its own authoritative transaction before changing Command/Effect state.
 */
export interface RecoveryRemoteProviderCapabilities {
  statusQuery: "none" | "eventually_consistent" | "authoritative_final";
  atomicIdempotency: boolean;
  epochFencing: boolean;
}

export type RecoveryRemoteProviderObservation =
  | { kind: "unknown" }
  | {
      kind: "applied";
      commandId: string;
      effectId: string;
      idempotencyKey: string;
      receiptId: string;
    }
  | {
      kind: "not_applied";
      commandId: string;
      effectId: string;
      idempotencyKey: string;
      noLateCommitGuarantee: boolean;
    };

export type RecoveryRemoteReconciliationDecision =
  | {
      action: "manual_review_required";
      reason:
        | "invalid_or_stale_fence"
        | "missing_unknown_ledger_state"
        | "non_authoritative_provider"
        | "observation_unavailable"
        | "observation_identity_mismatch"
        | "missing_finality_or_retry_safety";
    }
  | {
      action: "verified_applied_requires_receipt_persistence";
      receiptId: string;
    }
  | {
      action: "verified_not_applied_requires_fresh_authorized_claim";
    };

type LedgerView = { status: RecoveryEffectLedgerStatus; epoch: number } | undefined;

function isNonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 256;
}

export function planUnknownRemoteEffectRecovery(
  intent: RecoveryExternalEffectIntent,
  fence: RecoveryExternalEffectFence,
  ledgerView: LedgerView,
  capabilities: RecoveryRemoteProviderCapabilities,
  observation: RecoveryRemoteProviderObservation | undefined
): RecoveryRemoteReconciliationDecision {
  try {
    assertRecoveryExternalEffectFenceBinding(intent, fence);
  } catch {
    return { action: "manual_review_required", reason: "invalid_or_stale_fence" };
  }

  if (ledgerView?.status !== "unknown" || ledgerView.epoch !== fence.epoch) {
    return { action: "manual_review_required", reason: "missing_unknown_ledger_state" };
  }

  if (capabilities.statusQuery !== "authoritative_final") {
    return { action: "manual_review_required", reason: "non_authoritative_provider" };
  }
  if (!observation || observation.kind === "unknown") {
    return { action: "manual_review_required", reason: "observation_unavailable" };
  }

  if (observation.commandId !== intent.command.commandId ||
      observation.effectId !== intent.effectId ||
      observation.idempotencyKey !== intent.idempotencyKey) {
    return { action: "manual_review_required", reason: "observation_identity_mismatch" };
  }

  if (observation.kind === "applied") {
    if (!isNonempty(observation.receiptId)) {
      return { action: "manual_review_required", reason: "observation_unavailable" };
    }
    // Recommendation only: no mutation or terminal inference here.
    return {
      action: "verified_applied_requires_receipt_persistence",
      receiptId: observation.receiptId
    };
  }

  // Negative observations are safe only if the provider guarantees that an
  // earlier accepted request CANNOT later commit, and a new request is fenced
  // or idempotently deduped at the actual downstream effect boundary.
  if (!observation.noLateCommitGuarantee ||
      !(capabilities.atomicIdempotency || capabilities.epochFencing)) {
    return {
      action: "manual_review_required",
      reason: "missing_finality_or_retry_safety"
    };
  }

  // Candidate for a new, fresh authorization + lease, NOT permission to retry.
  return { action: "verified_not_applied_requires_fresh_authorized_claim" };
}
