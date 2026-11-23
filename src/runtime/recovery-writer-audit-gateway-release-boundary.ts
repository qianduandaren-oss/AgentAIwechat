/**
 * Day 94 evening: HOLD-only composition of signed/pinned gateway observations
 * with the Day 91-93 freeze / audit / three-source release blockers.
 *
 * This is an ISOLATED REVIEW. No TLS trust root, append-only authoritative
 * latest head, independent Host Collector, live Consumer ACK or OS FD clearance
 * is established by injected fixtures. NEVER use this function to grant GO.
 */
import {
  reviewDay93AuditReleaseBoundary,
  type Day93AuditReleaseBoundaryInput,
  type Day93AuditReleaseBoundaryReview
} from "./recovery-writer-inventory-audit-release-boundary.js";
import {
  reviewDay94PinnedGatewayWatermark,
  type Day94GatewayPinnedReview,
  type Day94GatewayTrustPolicyReader,
  type Day94GatewayPinnedChannel
} from "./recovery-writer-audit-gateway-pinned-watermark.js";

export interface Day94GatewayReleaseBoundaryInput
  extends Day93AuditReleaseBoundaryInput {
  /** Injected lab configuration; not an authoritative production trust root. */
  readonly policyReader: Day94GatewayTrustPolicyReader | null;
  /** Injected lab channel; inspectPeer() is NOT real mTLS verification. */
  readonly channel: Day94GatewayPinnedChannel | null;
}

export interface Day94GatewayReleaseBoundaryReview {
  readonly action: "hold";
  readonly gatewayReason: string;
  readonly auditReason: string;
  readonly freezeReason: string;
  readonly evidenceChainReasons: ReadonlyArray<string>;
  readonly blockers: ReadonlyArray<string>;
  readonly gatewayPeerMatchedInFixture: boolean;
  readonly gatewaySignatureVerifiedAgainstConfiguredPin: boolean;
  readonly pinnedMinimumSequence: number | null;
  readonly observedSequence: number | null;
  readonly requiredHostCheckSlots: number;
  readonly requiredSourceTasks: number;
  readonly authenticatedExternalAnchorCount: 0;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

const PERMANENT_BLOCKERS = [
  "gateway_policy_and_tls_peer_only_fixture_observations",
  "latest_external_monotonic_head_and_revocation_unproven",
  "inventory_host_fd_and_legacy_writer_isolation_unverified",
  "consumer_ack_and_raw_ack_ingress_unverified",
  "cross_source_consistency_and_atomicity_unproven",
  "production_release_not_authorized"
] as const;

/** Even an apparently perfect signature and synthetic 28/28 PASS stay HOLD. */
export async function reviewDay94GatewayReleaseBoundary(
  input: Day94GatewayReleaseBoundaryInput
): Promise<Day94GatewayReleaseBoundaryReview> {
  // Do not touch SQL stores or remote gateways for a production request.
  if (!input || input.intent !== "isolated_review") {
    return {
      action: "hold",
      gatewayReason: "production_release_not_authorized",
      auditReason: "not_evaluated",
      freezeReason: "not_evaluated",
      evidenceChainReasons: [],
      blockers: [...PERMANENT_BLOCKERS],
      gatewayPeerMatchedInFixture: false,
      gatewaySignatureVerifiedAgainstConfiguredPin: false,
      pinnedMinimumSequence: null,
      observedSequence: null,
      requiredHostCheckSlots: 0,
      requiredSourceTasks: 0,
      authenticatedExternalAnchorCount: 0,
      authenticatedEvidenceCount: 0,
      publishAuthorized: false
    };
  }

  // Both parts must fail closed, including an unexpectedly throwing adapter.
  const [releaseResult, gatewayResult] = await Promise.allSettled([
    reviewDay93AuditReleaseBoundary(input),
    reviewDay94PinnedGatewayWatermark({
      intent: "isolated_review",
      scope: input.scope,
      nowEpochMs: input.nowEpochMs,
      policyReader: input.policyReader,
      channel: input.channel
    })
  ]);
  const release: Day93AuditReleaseBoundaryReview | null =
    releaseResult.status === "fulfilled" ? releaseResult.value : null;
  const gateway: Day94GatewayPinnedReview | null =
    gatewayResult.status === "fulfilled" ? gatewayResult.value : null;
  const gatewayReason = gateway?.reason ?? "gateway_review_threw_fail_closed";
  const auditReason = release?.auditReason ?? "audit_release_review_threw_fail_closed";
  const freezeReason = release?.freezeReason ?? "freeze_review_not_available";
  const evidenceChainReasons = release?.evidenceChainReasons ?? [];
  const blockers = Array.from(new Set([
    "gateway:" + gatewayReason,
    "audit:" + auditReason,
    "freeze:" + freezeReason,
    ...evidenceChainReasons,
    ...(release?.blockers ?? []),
    ...PERMANENT_BLOCKERS
  ]));
  return {
    action: "hold",
    gatewayReason, auditReason, freezeReason, evidenceChainReasons,
    blockers,
    gatewayPeerMatchedInFixture: gateway?.peerMatchedInFixture ?? false,
    gatewaySignatureVerifiedAgainstConfiguredPin:
      gateway?.signatureVerifiedAgainstConfiguredPin ?? false,
    pinnedMinimumSequence: gateway?.pinnedMinimumSequence ?? null,
    observedSequence: gateway?.observedSequence ?? null,
    requiredHostCheckSlots: release?.requiredHostCheckSlots ?? 0,
    requiredSourceTasks: release?.requiredSourceTasks ?? 0,
    authenticatedExternalAnchorCount: 0,
    authenticatedEvidenceCount: 0,
    publishAuthorized: false
  };
}
