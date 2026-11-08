import { CutoverEvidenceGuard } from "./recovery-cutover-evidence-guard.js";
import type { CutoverEvidenceSource } from "./recovery-dispatcher-cutover-bootstrap.js";
import { reviewConsumerAckBinding } from "./recovery-outbox-ack-boundary.js";
import type { VerifiedConsumerAckAdapter } from "./recovery-outbox-authenticated-dispatch.js";
import type { RecoveryOutboxConsumerContract } from "./recovery-outbox-delivery-contract.js";
import { SQLiteFencedOutboxDelivery } from "./recovery-fenced-outbox-delivery.js";
import type { RecoverySingleWriterServicePort } from "./recovery-single-writer-service-contract.js";

/** Supplied by the trusted coordinator, never by a client request. */
export interface TrustedWriterIdentitySource {
  snapshot(): Promise<Readonly<{ ownerId: string; epoch: number }> | null>;
}

/** Candidate-only wiring. Neither this interface nor its mocks prove OS-level SQLite exclusivity. */
export interface SingleWriterCandidateDependencies {
  store: SQLiteFencedOutboxDelivery;
  cutoverEvidence: CutoverEvidenceSource;
  writerIdentity: TrustedWriterIdentitySource;
  verifiedAckAdapter: VerifiedConsumerAckAdapter;
  consumer: RecoveryOutboxConsumerContract;
  consumerId: string;
  clock: () => number;
  leaseMs: number;
  maxEvidenceAgeMs: number;
}

type Hold = { action: "hold"; reason: string };
type Context = { action: "continue"; ownerId: string; epoch: number; nowEpochMs: number };

function configOk(d: SingleWriterCandidateDependencies): boolean {
  return typeof d.consumerId === "string" && d.consumerId.trim().length > 0 &&
    typeof d.verifiedAckAdapter?.verify === "function" &&
    typeof d.writerIdentity?.snapshot === "function" &&
    typeof d.clock === "function" &&
    Number.isSafeInteger(d.leaseMs) && d.leaseMs > 0 &&
    Number.isSafeInteger(d.maxEvidenceAgeMs) && d.maxEvidenceAgeMs > 0;
}

export class RecoverySingleWriterCandidateService implements RecoverySingleWriterServicePort {
  private readonly gate: CutoverEvidenceGuard;
  constructor(private readonly deps: SingleWriterCandidateDependencies) {
    this.gate = new CutoverEvidenceGuard(deps.cutoverEvidence);
  }

  /** Every operation rechecks deployment evidence, then obtains server-owned identity/time. */
  private async context(): Promise<Context | Hold> {
    const result = await this.gate.check();
    if (result.action === "hold") return result;
    try {
      const identity = await this.deps.writerIdentity.snapshot();
      const nowEpochMs = this.deps.clock();
      if (!identity?.ownerId?.trim() ||
          !Number.isSafeInteger(identity.epoch) || identity.epoch <= 0 ||
          !Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        return { action: "hold", reason: "trusted_writer_context_invalid" };
      }
      return { action: "continue", ownerId: identity.ownerId, epoch: identity.epoch, nowEpochMs };
    } catch {
      return { action: "hold", reason: "trusted_writer_context_unavailable" };
    }
  }

  async claimOutbox(input: Readonly<{ outboxId: string }>) {
    if (!input?.outboxId?.trim()) return { action: "hold" as const, reason: "invalid_outbox_id" };
    const ctx = await this.context();
    if (ctx.action === "hold") return ctx;
    try {
      const result = this.deps.store.claim({
        outboxId: input.outboxId,
        workerId: ctx.ownerId,
        epoch: ctx.epoch,
        consumer: this.deps.consumer,
        nowEpochMs: ctx.nowEpochMs,
        leaseMs: this.deps.leaseMs
      });
      if (result.action === "claimed")
        return { action: "claimed" as const, eventId: result.record.eventId, leaseToken: result.leaseToken };
      if (result.action === "already_dispatched")
        return { action: "already_dispatched" as const, eventId: result.eventId };
      if (result.action === "busy") {
        const record = this.deps.store.inspect(input.outboxId);
        return record ? { action: "busy" as const, eventId: record.eventId } :
          { action: "hold" as const, reason: "outbox_missing" };
      }
      return { action: "hold" as const, reason: result.action === "hold" ? result.reason : "claim_not_issued" };
    } catch {
      return { action: "hold" as const, reason: "claim_transaction_rejected" };
    }
  }

  async confirmOutbox(input: Readonly<{
    outboxId: string;
    eventId: string;
    leaseToken: string;
    rawConsumerResponse: unknown;
  }>) {
    if (!input?.outboxId?.trim() || !input?.eventId?.trim() || !input?.leaseToken?.trim()) {
      return { action: "hold" as const, reason: "invalid_ack_request" };
    }
    const before = await this.context();
    if (before.action === "hold") return before;
    let record: ReturnType<SQLiteFencedOutboxDelivery["inspect"]>;
    try {
      record = this.deps.store.inspect(input.outboxId);
    } catch {
      return { action: "hold" as const, reason: "outbox_inspection_failed" };
    }
    if (!record || record.eventId !== input.eventId)
      return { action: "hold" as const, reason: "outbox_missing_or_mismatched" };

    let evidence: Awaited<ReturnType<VerifiedConsumerAckAdapter["verify"]>>;
    try {
      evidence = await this.deps.verifiedAckAdapter.verify(input.rawConsumerResponse);
    } catch {
      return { action: "hold" as const, reason: "consumer_authentication_failed" };
    }
    if (!evidence) return { action: "hold" as const, reason: "consumer_authentication_failed" };

    // Authentication is asynchronous: recheck gate, writer identity and time AFTER verification.
    const after = await this.context();
    if (after.action === "hold") return after;
    const review = reviewConsumerAckBinding(evidence, {
      outboxId: record.id,
      eventId: record.eventId,
      commandId: record.commandId,
      runId: record.runId,
      consumerId: this.deps.consumerId,
      nowEpochMs: after.nowEpochMs,
      maxEvidenceAgeMs: this.deps.maxEvidenceAgeMs
    });
    if (review.action === "hold") return review;
    try {
      const result = this.deps.store.acknowledge({
        outboxId: input.outboxId,
        eventId: input.eventId,
        leaseToken: input.leaseToken,
        workerId: after.ownerId,
        epoch: after.epoch,
        nowEpochMs: after.nowEpochMs
      });
      return result.action === "dispatched" ?
        { action: "dispatched" as const, eventId: input.eventId } :
        { action: "already_dispatched" as const, eventId: input.eventId };
    } catch {
      return { action: "hold" as const, reason: "ack_transaction_rejected" };
    }
  }
}

/** Candidate test mode only. Cutover booleans do not grant publish/production authorization. */
export async function bootstrapSingleWriterCandidate(deps: SingleWriterCandidateDependencies):
  Promise<
    | { action: "hold"; reason: string; service?: never; publishAuthorized: false }
    | { action: "ready_for_candidate_tests"; service: RecoverySingleWriterCandidateService; publishAuthorized: false }
  > {
  if (!configOk(deps)) return { action: "hold", reason: "candidate_configuration_invalid", publishAuthorized: false };
  const guard = new CutoverEvidenceGuard(deps.cutoverEvidence);
  const gate = await guard.check();
  if (gate.action === "hold") return { ...gate, publishAuthorized: false };
  try {
    const identity = await deps.writerIdentity.snapshot();
    if (!identity?.ownerId?.trim() || !Number.isSafeInteger(identity.epoch) || identity.epoch <= 0)
      return { action: "hold", reason: "trusted_writer_context_invalid", publishAuthorized: false };
  } catch {
    return { action: "hold", reason: "trusted_writer_context_unavailable", publishAuthorized: false };
  }
  return { action: "ready_for_candidate_tests", service: new RecoverySingleWriterCandidateService(deps), publishAuthorized: false };
}
