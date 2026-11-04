import { reviewConsumerAckBinding, type ConsumerAckEvidence } from "./recovery-outbox-ack-boundary.js";
import { SQLiteRecoveryOutboxDeliveryClaimer, type RecoveryDeliveryAckResult } from "./recovery-outbox-delivery-lease.js";

/** Trusted server-side adapter: the verifier MUST authenticate the remote consumer
 * over a verified channel/signature, bind its identity to consumerId, and reject
 * replayed/invalid evidence. A source string or TypeScript cast is never proof. */
export interface VerifiedConsumerAckAdapter {
  verify(rawResponse: unknown): Promise<ConsumerAckEvidence | null>;
}

export type VerifiedAckOutcome =
  | { action: "hold"; reason: string }
  | RecoveryDeliveryAckResult;

/** Candidate integration boundary, not a production security authority.
 * Lease CAS is rechecked in the SQLite claimer after verification. */
export async function acknowledgeVerifiedConsumerDelivery(
  store: SQLiteRecoveryOutboxDeliveryClaimer,
  adapter: VerifiedConsumerAckAdapter,
  input: {
    outboxId: string;
    eventId: string;
    leaseToken: string;
    consumerId: string;
    rawResponse: unknown;
    nowEpochMs: number;
    maxEvidenceAgeMs: number;
  }
): Promise<VerifiedAckOutcome> {
  const record = store.inspect(input.outboxId);
  if (!record || record.eventId !== input.eventId) {
    return { action: "hold", reason: "outbox_missing_or_mismatched" };
  }
  let evidence: ConsumerAckEvidence | null;
  try {
    evidence = await adapter.verify(input.rawResponse);
  } catch {
    return { action: "hold", reason: "consumer_authentication_failed" };
  }
  if (!evidence) return { action: "hold", reason: "consumer_authentication_failed" };
  const review = reviewConsumerAckBinding(evidence, {
    eventId: record.eventId,
    outboxId: record.id,
    commandId: record.commandId,
    runId: record.runId,
    consumerId: input.consumerId,
    nowEpochMs: input.nowEpochMs,
    maxEvidenceAgeMs: input.maxEvidenceAgeMs
  });
  if (review.action === "hold") return review;
  // IMPORTANT: legacy acknowledge() remains callable by other code with a
  // forgeable source literal. Cutover must restrict that method before GO.
  return store.acknowledge({
    outboxId: record.id,
    eventId: record.eventId,
    leaseToken: input.leaseToken,
    source: "authenticated_consumer_adapter",
    nowEpochMs: input.nowEpochMs
  });
}
