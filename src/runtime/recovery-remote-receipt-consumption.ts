import {
  assertRecoveryExternalEffectFenceBinding,
  type RecoveryExternalEffectFence,
  type RecoveryExternalEffectIntent
} from "./recovery-external-effect-fence.js";
import type {
  RecoveryRemoteReceiptTerminalReview
} from "./recovery-external-effect-ledger.js";

/**
 * Day 73 MORNING: immutable proposal for a FUTURE same-SQLite receipt
 * consumption CAS. Pure planning only: NO database writes, no provider calls,
 * no terminal mutation, and no execution authorization.
 *
 * The eventual Finalizer must re-read the stored receipt, Ledger UNKNOWN +
 * epoch, executing-v2 Command, same-SQLite ACL, Control CAS and provider
 * conformance inside its OWN write boundary. External registry consistency
 * is NOT guaranteed by a SQLite lock.
 */
export interface RecoveryRemoteReceiptConsumptionInput {
  intent: RecoveryExternalEffectIntent;
  fence: RecoveryExternalEffectFence;
  providerId: string;
  review: RecoveryRemoteReceiptTerminalReview;
}

export type RecoveryRemoteReceiptConsumptionPlan =
  | {
      action: "hold";
      reason: "invalid_fence" | "review_not_ready" |
        "unsupported_owner" | "identity_mismatch" |
        "invalid_receipt_identity" | "version_mismatch";
    }
  | {
      action: "requires_atomic_receipt_consumption";
      providerId: string;
      receiptId: string;
      effectId: string;
      idempotencyKey: string;
      commandId: string;
      runId: string;
      epoch: number;
      expectedEffectStatus: "unknown";
      expectedCommandStatus: "executing";
      expectedCommandVersion: 2;
      expectedControlVersion: number;
      /** This is never an automatic resend instruction. */
      automaticUnknownResend: false;
    };

function validId(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 && value.length <= 256;
}

/** A readiness snapshot is a HINT, never a reusable authorization token. */
export function planRemoteReceiptConsumption(
  input: RecoveryRemoteReceiptConsumptionInput
): RecoveryRemoteReceiptConsumptionPlan {
  const hold = (reason: Extract<RecoveryRemoteReceiptConsumptionPlan,
    { action: "hold" }>["reason"]): RecoveryRemoteReceiptConsumptionPlan =>
    ({ action: "hold", reason });

  try {
    assertRecoveryExternalEffectFenceBinding(input.intent, input.fence);
  } catch {
    return hold("invalid_fence");
  }
  if (input.review.action !== "requires_atomic_terminal_transaction") {
    return hold("review_not_ready");
  }
  if (input.intent.owner !== "atomic_control_only") {
    return hold("unsupported_owner");
  }
  if (!validId(input.providerId) || !validId(input.review.receiptId)) {
    return hold("invalid_receipt_identity");
  }
  if (input.review.commandId !== input.intent.command.commandId ||
      input.review.runId !== input.intent.command.runId) {
    return hold("identity_mismatch");
  }
  const expected = input.intent.command.expectedControlVersion;
  if (input.review.expectedCommandVersion !== 2 ||
      typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 ||
      input.review.expectedControlVersion !== expected) {
    return hold("version_mismatch");
  }
  return {
    action: "requires_atomic_receipt_consumption",
    providerId: input.providerId,
    receiptId: input.review.receiptId,
    effectId: input.intent.effectId,
    idempotencyKey: input.intent.idempotencyKey,
    commandId: input.intent.command.commandId,
    runId: input.intent.command.runId,
    epoch: input.fence.epoch,
    expectedEffectStatus: "unknown",
    expectedCommandStatus: "executing",
    expectedCommandVersion: 2,
    expectedControlVersion: expected,
    automaticUnknownResend: false
  };
}
