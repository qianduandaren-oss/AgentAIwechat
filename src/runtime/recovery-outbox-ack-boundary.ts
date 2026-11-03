/** Day 75 morning: pure policy boundary. This does NOT authenticate an ACK. */
export interface ConsumerAckEvidence {
  eventId: string;
  outboxId: string;
  commandId: string;
  runId: string;
  consumerId: string;
  evidenceId: string;
  observedAtEpochMs: number;
}
export interface ExpectedAckBinding {
  eventId: string;
  outboxId: string;
  commandId: string;
  runId: string;
  consumerId: string;
  nowEpochMs: number;
  maxEvidenceAgeMs: number;
}
export type AckReview =
  | { action: "hold"; reason: string }
  | { action: "requires_authenticated_adapter_and_current_lease"; evidenceId: string; eventId: string; ackAuthorized: false };
/** Never accepts a source label as proof of identity; caller must verify cryptographic/channel authentication separately. */
export function reviewConsumerAckBinding(evidence: ConsumerAckEvidence, expected: ExpectedAckBinding): AckReview {
  const hold = (reason: string): AckReview => ({ action: "hold", reason });
  if (!evidence || !expected) return hold("missing_evidence");
  const ids = [evidence.eventId, evidence.outboxId, evidence.commandId, evidence.runId, evidence.consumerId, evidence.evidenceId,
    expected.eventId, expected.outboxId, expected.commandId, expected.runId, expected.consumerId];
  if (ids.some(v => typeof v !== "string" || !v.trim())) return hold("invalid_identity");
  if (evidence.eventId !== expected.eventId || evidence.outboxId !== expected.outboxId ||
      evidence.commandId !== expected.commandId || evidence.runId !== expected.runId ||
      evidence.consumerId !== expected.consumerId) return hold("identity_mismatch");
  if (!Number.isSafeInteger(expected.nowEpochMs) || !Number.isSafeInteger(evidence.observedAtEpochMs) ||
      !Number.isSafeInteger(expected.maxEvidenceAgeMs) || expected.maxEvidenceAgeMs <= 0 ||
      evidence.observedAtEpochMs > expected.nowEpochMs ||
      expected.nowEpochMs - evidence.observedAtEpochMs > expected.maxEvidenceAgeMs) return hold("stale_or_future_evidence");
  return { action: "requires_authenticated_adapter_and_current_lease", evidenceId: evidence.evidenceId, eventId: evidence.eventId, ackAuthorized: false };
}
