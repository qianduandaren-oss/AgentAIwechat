/** Day 95 evening: replace the Day 94 gateway branch with lifecycle review.
 * All inputs are lab candidates; never issue a production capability. */
import {
  reviewDay93AuditReleaseBoundary,
  type Day93AuditReleaseBoundaryInput
} from "./recovery-writer-inventory-audit-release-boundary.js";
import {
  reviewDay95GatewayLifecycle,
  type Day95LifecycleInput
} from "./recovery-writer-audit-gateway-key-lifecycle.js";

export interface Day95LifecycleReleaseInput extends Day93AuditReleaseBoundaryInput,
  Pick<Day95LifecycleInput, "baseline" | "lifecycleReader" | "clock" | "channel"> {}

const permanentBlockers = [
  "gateway_policy_and_tls_peer_only_fixture_observations",
  "latest_external_monotonic_head_and_revocation_unproven",
  "inventory_host_fd_and_legacy_writer_isolation_unverified",
  "consumer_ack_and_raw_ack_ingress_unverified",
  "cross_source_consistency_and_atomicity_unproven",
  "atomic_policy_epoch_authorization_not_implemented",
  "production_release_not_authorized"
] as const;

export async function reviewDay95LifecycleReleaseBoundary(input: Day95LifecycleReleaseInput) {
  const fixed = { action: "hold" as const, authenticatedExternalAnchorCount: 0 as const,
    authenticatedEvidenceCount: 0 as const, publishAuthorized: false as const };
  if (!input || input.intent !== "isolated_review") return {
    ...fixed, lifecycleReason: "production_release_not_authorized",
    signatureVerified: false, policyEpoch: null, auditReason: "not_evaluated",
    freezeReason: "not_evaluated", evidenceChainReasons: [] as readonly string[],
    requiredHostCheckSlots: 0, requiredSourceTasks: 0, blockers: [...permanentBlockers] as string[]
  };

  // The Day 95 wrapper already performs Day 94 verification exactly once.
  // Do not query the gateway again using the older single-read policy.
  const [releaseResult, lifecycleResult] = await Promise.allSettled([
    reviewDay93AuditReleaseBoundary(input),
    reviewDay95GatewayLifecycle({
      intent: "isolated_review", scope: input.scope, baseline: input.baseline,
      lifecycleReader: input.lifecycleReader, clock: input.clock, channel: input.channel
    })
  ]);
  const release = releaseResult.status === "fulfilled" ? releaseResult.value : null;
  const lifecycle = lifecycleResult.status === "fulfilled" ? lifecycleResult.value : null;
  const lifecycleReason = lifecycle?.reason ?? "lifecycle_review_threw_fail_closed";
  const auditReason = release?.auditReason ?? "audit_release_review_threw_fail_closed";
  const freezeReason = release?.freezeReason ?? "freeze_review_not_available";
  const evidenceChainReasons = release?.evidenceChainReasons ?? [];
  return {
    ...fixed, lifecycleReason, auditReason, freezeReason, evidenceChainReasons,
    signatureVerified: lifecycle?.signatureVerified ?? false,
    policyEpoch: lifecycle?.policyEpoch ?? null,
    requiredHostCheckSlots: release?.requiredHostCheckSlots ?? 0,
    requiredSourceTasks: release?.requiredSourceTasks ?? 0,
    blockers: Array.from(new Set([
      "lifecycle:" + lifecycleReason, "audit:" + auditReason, "freeze:" + freezeReason,
      ...evidenceChainReasons, ...(release?.blockers ?? []), ...permanentBlockers
    ]))
  };
}
