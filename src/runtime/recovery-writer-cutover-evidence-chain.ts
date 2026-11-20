/**
 * Day 91 evening: three-source release provenance continuity review.
 * This is an advisory, read-only FAIL-CLOSED reviewer, NOT a production gate.
 * It never accepts a caller-supplied "verified" flag as authentication.
 */
import {
  reviewDay91DeploymentInventory,
  type Day91DeploymentInventoryAdapter,
  type Day91InventoryAnchor
} from "./recovery-writer-cutover-inventory-adapter.js";
import {
  planDay91CutoverProvenance
} from "./recovery-writer-cutover-evidence-provenance.js";
import {
  reviewWriterCutoverEvidenceCoverage,
  type WriterCutoverEvidenceReceipt,
  type WriterCutoverEvidenceScope
} from "./recovery-writer-cutover-evidence-coverage.js";
import {
  reviewDay90ReleaseBlockers,
  type Day90FixtureHazard
} from "./recovery-writer-cutover-release-blockers.js";

export interface Day91ConsumerAckCandidate {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
  readonly consumerId: string;
  readonly receivedAtEpochMs: number;
  readonly rawIngressClosed: boolean;
  /** Claimed by the caller. It is NOT an authenticated consumer identity. */
  readonly claimedAuthenticated?: boolean;
}

export interface Day91EvidenceChainInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly expectedAnchor: Day91InventoryAnchor;
  readonly nowEpochMs: number;
  readonly inventoryAdapter: Day91DeploymentInventoryAdapter | null;
  readonly hostReceipts: ReadonlyArray<WriterCutoverEvidenceReceipt>;
  readonly consumerAck: Day91ConsumerAckCandidate | null;
  readonly observedFixtureHazards?: ReadonlyArray<Day90FixtureHazard>;
}

export interface Day91EvidenceChainReview {
  readonly action: "hold";
  readonly sources: Readonly<{
    inventory: string;
    hostCollector: string;
    consumerAck: string;
  }>;
  readonly reasons: ReadonlyArray<string>;
  readonly inventoryCandidateMatched: boolean;
  readonly hostReceiptCandidates: number;
  readonly requiredHostCheckSlots: number;
  readonly requiredSourceTasks: number;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

const nonempty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function reviewAckClaim(
  ack: Day91ConsumerAckCandidate | null,
  scope: WriterCutoverEvidenceScope,
  now: number
): string {
  if (ack === null) return "consumer_ack_missing";
  if (!ack || ack.deploymentId !== scope.deploymentId ||
      ack.releaseId !== scope.releaseId ||
      ack.attemptId !== scope.attemptId) return "consumer_ack_scope_mismatch";
  if (!nonempty(ack.consumerId) || !Number.isSafeInteger(ack.receivedAtEpochMs) ||
      !Number.isSafeInteger(now) || ack.receivedAtEpochMs > now ||
      now - ack.receivedAtEpochMs > 300_000) {
    return "consumer_ack_identity_or_time_invalid";
  }
  if (ack.rawIngressClosed !== true) return "raw_ack_ingress_not_proven_closed";
  // Even matching fields and claimedAuthenticated=true cannot authenticate
  // the Consumer peer or prove its durable inbox / real message effect.
  return "consumer_ack_candidate_unverified";
}

/** Compose existing Day 90/91 boundaries without inventing trusted evidence. */
export async function reviewDay91EvidenceChain(
  input: Day91EvidenceChainInput
): Promise<Day91EvidenceChainReview> {
  const plan = planDay91CutoverProvenance({
    intent: input.intent,
    scope: input.scope,
    claimedInventory: null
  });
  const inventory = await reviewDay91DeploymentInventory({
    intent: input.intent,
    scope: input.scope,
    expectedAnchor: input.expectedAnchor,
    nowEpochMs: input.nowEpochMs,
    adapter: input.inventoryAdapter
  });
  const coverage = reviewWriterCutoverEvidenceCoverage({
    intent: input.intent === "production_release" ? "production_release" : "isolated_review",
    scope: input.scope,
    nowEpochMs: input.nowEpochMs,
    receipts: input.hostReceipts
  });
  const hostReason = coverage.action === "hold"
    ? "host_evidence_" + coverage.reason
    : "host_coverage_only_metadata_unverified";
  const ackReason = reviewAckClaim(input.consumerAck, input.scope, input.nowEpochMs);
  const blockers = reviewDay90ReleaseBlockers({
    intent: input.intent,
    scope: input.scope,
    nowEpochMs: input.nowEpochMs,
    receipts: input.hostReceipts,
    localSignals: [],
    observedFixtureHazards: input.observedFixtureHazards ?? []
  });
  const reasons = [
    "inventory:" + inventory.reason,
    "host:" + hostReason,
    "consumer:" + ackReason,
    "external_audit_anchor_missing",
    "trusted_os_and_legacy_write_isolation_unverified",
    ...blockers.reasons.filter(reason =>
      reason.startsWith("reproduced_unsafe_fixture:"))
  ];
  if (input.intent === "production_release") {
    reasons.unshift("production_release_not_authorized");
  }
  return {
    action: "hold",
    sources: {
      inventory: inventory.reason,
      hostCollector: hostReason,
      consumerAck: ackReason
    },
    reasons,
    inventoryCandidateMatched: inventory.candidateMatched,
    hostReceiptCandidates: input.hostReceipts.length,
    requiredHostCheckSlots: plan.hostCheckSlots,
    requiredSourceTasks: plan.requirements.length,
    authenticatedEvidenceCount: 0,
    publishAuthorized: false
  };
}
