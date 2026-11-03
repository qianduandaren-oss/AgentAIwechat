import type { RecoveryOutboxRecord } from "./recovery-outbox.js";

/**
 * Day 74 morning: a PURE preflight for the existing Recovery Outbox.
 * This is NOT a delivery lease, publisher, acknowledgement or permission
 * to retry an external side effect. Noon must add a same-SQLite claim.
 */
export interface RecoveryOutboxConsumerContract {
  /** Verified at the downstream consumer, not merely claimed by the sender. */
  durableDedupeByEventId: boolean;
  /** Consumer's durable event-ID retention window. */
  dedupeRetentionSeconds: number;
  /** Longest supported retry/recovery horizon. */
  deliveryRecoveryWindowSeconds: number;
  /** ACK must identify the same eventId and be issued by the trusted sink. */
  authenticatedEventAck: boolean;
}

export type RecoveryOutboxDeliveryPlan =
  | { action: "hold"; reason:
      | "invalid_outbox_record"
      | "consumer_dedupe_unverified"
      | "dedupe_window_insufficient"
      | "ack_contract_unverified" }
  | { action: "already_dispatched"; eventId: string }
  | {
      action: "requires_atomic_delivery_claim";
      outboxId: string;
      eventId: string;
      commandId: string;
      runId: string;
      expectedVersion: number;
      consumerIdempotencyKey: string;
      /** The caller must NOT publish until a durable claim is acquired. */
      publishAuthorized: false;
    };

export function planRecoveryOutboxDelivery(
  record: RecoveryOutboxRecord,
  consumer: RecoveryOutboxConsumerContract
): RecoveryOutboxDeliveryPlan {
  if (!record || !record.id?.trim() || !record.eventId?.trim() ||
      !record.commandId?.trim() || !record.runId?.trim() ||
      !record.payload?.trim() ||
      (record.kind !== "audit" && record.kind !== "recovery_event") ||
      (record.status !== "pending" && record.status !== "dispatched") ||
      !Number.isSafeInteger(record.version) || record.version < 1 ||
      !Number.isSafeInteger(record.attempts) || record.attempts < 0) {
    return { action: "hold", reason: "invalid_outbox_record" };
  }
  if (record.status === "dispatched") {
    return { action: "already_dispatched", eventId: record.eventId };
  }
  if (!consumer?.durableDedupeByEventId) {
    return { action: "hold", reason: "consumer_dedupe_unverified" };
  }
  if (!Number.isSafeInteger(consumer.dedupeRetentionSeconds) ||
      !Number.isSafeInteger(consumer.deliveryRecoveryWindowSeconds) ||
      consumer.deliveryRecoveryWindowSeconds <= 0 ||
      consumer.dedupeRetentionSeconds < consumer.deliveryRecoveryWindowSeconds) {
    return { action: "hold", reason: "dedupe_window_insufficient" };
  }
  if (!consumer.authenticatedEventAck) {
    return { action: "hold", reason: "ack_contract_unverified" };
  }
  return {
    action: "requires_atomic_delivery_claim",
    outboxId: record.id,
    eventId: record.eventId,
    commandId: record.commandId,
    runId: record.runId,
    expectedVersion: record.version,
    consumerIdempotencyKey: record.eventId,
    publishAuthorized: false
  };
}
