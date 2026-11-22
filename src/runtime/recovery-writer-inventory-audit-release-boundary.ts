/**
 * Day 93 evening. Compose existing candidate-only provenance, frozen inventory
 * and separate-file audit-watermark reviews. This is a HOLD-only diagnostic,
 * not an authenticated external log or production admission gate.
 */
import {
  reviewDay92FrozenCutoverBoundary,
  type Day92FrozenCutoverReviewInput
} from "./recovery-writer-inventory-freeze-release-boundary.js";
import {
  reviewDay93AuditAnchorCandidate,
  type Day93AuditAnchorReader
} from "./recovery-writer-inventory-audit-anchor.js";

export interface Day93AuditReleaseBoundaryInput extends Day92FrozenCutoverReviewInput {
  /** Injected fixture reader. Never treat the returned value as authenticated. */
  readonly auditReader: Day93AuditAnchorReader | null;
}

export interface Day93AuditReleaseBoundaryReview {
  readonly action: "hold";
  readonly auditReason: string;
  readonly freezeReason: string;
  readonly evidenceChainReasons: ReadonlyArray<string>;
  readonly blockers: ReadonlyArray<string>;
  readonly requiredHostCheckSlots: number;
  readonly requiredSourceTasks: number;
  readonly authenticatedExternalAnchorCount: 0;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

/** Report WHY we cannot publish, including when both local databases agree. */
export async function reviewDay93AuditReleaseBoundary(
  input: Day93AuditReleaseBoundaryInput
): Promise<Day93AuditReleaseBoundaryReview> {
  const audit = await reviewDay93AuditAnchorCandidate({
    intent: input.intent,
    scope: input.scope,
    store: input.store,
    reader: input.auditReader,
    nowEpochMs: input.nowEpochMs
  });
  const freeze = await reviewDay92FrozenCutoverBoundary(input);
  return {
    action: "hold",
    auditReason: audit.reason,
    freezeReason: freeze.freezeReason,
    evidenceChainReasons: freeze.evidenceChainReasons,
    blockers: [
      "audit:" + audit.reason,
      "freeze:" + freeze.freezeReason,
      ...freeze.evidenceChainReasons,
      "fixture_audit_reader_not_independently_authenticated",
      "same_trust_domain_double_rollback_not_excluded",
      "host_os_legacy_fd_and_consumer_ack_unverified",
      ...(input.intent === "production_release"
        ? ["production_release_not_authorized"] : [])
    ],
    requiredHostCheckSlots: freeze.requiredHostCheckSlots,
    requiredSourceTasks: freeze.requiredSourceTasks,
    authenticatedExternalAnchorCount: 0,
    authenticatedEvidenceCount: 0,
    publishAuthorized: false
  };
}
