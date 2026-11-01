import {
  assertRecoveryExternalEffectFenceBinding,
  type RecoveryExternalEffectFence,
  type RecoveryExternalEffectIntent
} from "./recovery-external-effect-fence.js";
import type { RecoveryEffectLedgerStatus } from "./recovery-external-effect-ledger.js";
import {
  planUnknownRemoteEffectRecovery
} from "./recovery-external-effect-reconciliation.js";
import {
  reviewRecoveryProviderConformance,
  type RecoveryProviderConformanceRegistry
} from "./recovery-provider-conformance-gate.js";

/**
 * Day 72 MORNING: read-only remote receipt boundary, following Day 70's
 * UNKNOWN reconciler and Day 71's provider conformance gate.
 *
 * The authenticated adapter MUST construct observations from verified provider
 * responses. A source literal, TypeScript type, or client JSON is not proof.
 * This candidate NEVER inserts receipts, changes Ledger/Command or sends tools.
 */
export interface RecoveryRemoteAppliedReceipt {
  source: "authenticated_server_adapter";
  providerId: string;
  profileRevision: number;
  receiptId: string;
  commandId: string;
  runId: string;
  operation: RecoveryExternalEffectIntent["command"]["operation"];
  actorId: string;
  tenantId: string;
  owner: RecoveryExternalEffectIntent["owner"];
  effectId: string;
  idempotencyKey: string;
  epoch: number;
  /** Trusted adapter's observation time, NOT client/provider-reported wall time. */
  observedAtEpochMs: number;
}

export interface AuthenticatedRecoveryRemoteReceiptAdapter {
  /** Future integration point; no production implementation exists. */
  queryAppliedReceipt(
    providerId: string,
    effectId: string
  ): Promise<RecoveryRemoteAppliedReceipt | undefined>;
}

export interface RecoveryRemoteReceiptReviewInput {
  intent: RecoveryExternalEffectIntent;
  fence: RecoveryExternalEffectFence;
  ledger: { status: RecoveryEffectLedgerStatus; epoch: number } | undefined;
  providerId: string;
  receipt: RecoveryRemoteAppliedReceipt | undefined;
  recoveryWindowSeconds: number;
  nowEpochMs: number;
  maxProbeAgeMs: number;
  maxObservationAgeMs: number;
}

export type RecoveryRemoteReceiptReview =
  | {
      action: "manual_review_required";
      reason:
        | "bad_or_stale_effect_fence"
        | "ledger_not_unknown"
        | "provider_conformance_denied"
        | "missing_or_untrusted_receipt"
        | "receipt_identity_mismatch"
        | "receipt_revision_mismatch"
        | "receipt_observation_stale"
        | "authority_unavailable";
    }
  | {
      action: "needs_transactional_receipt_commit";
      providerId: string;
      receiptId: string;
      effectId: string;
      idempotencyKey: string;
      commandId: string;
      epoch: number;
    };

function textId(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 && value.length <= 256;
}

function positiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * A safe candidate for the NEXT step (durable remote receipt write).
 * It is not a receipt authentication mechanism or state transition.
 * The eventual persistence transaction must check live ACL, owner,
 * Ledger epoch/state, unique receipt identity and terminal CAS again.
 */
export function reviewRemoteAppliedReceiptForPersistence(
  registry: RecoveryProviderConformanceRegistry,
  input: RecoveryRemoteReceiptReviewInput
): RecoveryRemoteReceiptReview {
  const deny = (reason: Extract<RecoveryRemoteReceiptReview,
    { action: "manual_review_required" }>["reason"]): RecoveryRemoteReceiptReview =>
    ({ action: "manual_review_required", reason });

  try {
    assertRecoveryExternalEffectFenceBinding(input.intent, input.fence);
  } catch {
    return deny("bad_or_stale_effect_fence");
  }
  if (input.ledger?.status !== "unknown" ||
      input.ledger.epoch !== input.fence.epoch) {
    return deny("ledger_not_unknown");
  }

  // A plain request body must not be passed as the registry or receipt.
  // All such inputs come from authenticated, server-owned dependencies.
  try {
    const revisionBefore = registry.getCurrentProfileRevision(input.providerId);
    const conformance = reviewRecoveryProviderConformance(
      registry,
      {
        providerId: input.providerId,
        operation: "reconcile_unknown_applied",
        effectStatus: "unknown",
        recoveryWindowSeconds: input.recoveryWindowSeconds
      },
      input.nowEpochMs,
      input.maxProbeAgeMs
    );
    const profile = registry.getVerifiedProfile(input.providerId);
    const revisionAfter = registry.getCurrentProfileRevision(input.providerId);
    if (!conformance.candidate || !profile ||
        profile.providerId !== input.providerId ||
        profile.capabilities.statusQuery !== "authoritative_final" ||
        !profile.stableReceiptIdentity ||
        !positiveInteger(revisionBefore) ||
        revisionBefore !== revisionAfter) {
      return deny("provider_conformance_denied");
    }

    const r = input.receipt;
    if (!r || r.source !== "authenticated_server_adapter" ||
        !textId(r.receiptId) || !textId(r.providerId)) {
      return deny("missing_or_untrusted_receipt");
    }
    if (r.providerId !== input.providerId ||
        r.commandId !== input.intent.command.commandId ||
        r.runId !== input.intent.command.runId ||
        r.operation !== input.intent.command.operation ||
        r.actorId !== input.intent.command.requestedBy ||
        r.tenantId !== input.intent.authorizationEvidence.tenantId ||
        r.owner !== input.intent.owner ||
        r.effectId !== input.intent.effectId ||
        r.idempotencyKey !== input.intent.idempotencyKey ||
        r.epoch !== input.fence.epoch) {
      return deny("receipt_identity_mismatch");
    }
    if (!positiveInteger(r.profileRevision) ||
        r.profileRevision !== revisionBefore) {
      return deny("receipt_revision_mismatch");
    }
    if (!positiveInteger(input.nowEpochMs) ||
        !positiveInteger(input.maxObservationAgeMs) ||
        !positiveInteger(r.observedAtEpochMs) ||
        r.observedAtEpochMs > input.nowEpochMs ||
        input.nowEpochMs - r.observedAtEpochMs >
          input.maxObservationAgeMs) {
      return deny("receipt_observation_stale");
    }

    // Reuse the existing UNKNOWN policy; even a valid applied observation
    // must only request persistence, never declare a successful terminal.
    const planned = planUnknownRemoteEffectRecovery(
      input.intent,
      input.fence,
      input.ledger,
      profile.capabilities,
      {
        kind: "applied",
        commandId: r.commandId,
        effectId: r.effectId,
        idempotencyKey: r.idempotencyKey,
        receiptId: r.receiptId
      }
    );
    if (planned.action !== "verified_applied_requires_receipt_persistence") {
      return deny("provider_conformance_denied");
    }
    return {
      action: "needs_transactional_receipt_commit",
      providerId: r.providerId,
      receiptId: planned.receiptId,
      effectId: r.effectId,
      idempotencyKey: r.idempotencyKey,
      commandId: r.commandId,
      epoch: r.epoch
    };
  } catch {
    return deny("authority_unavailable");
  }
}
