/**
 * Day 91 morning: upstream provenance requirements for the existing
 * Day 90 cutover evidence matrix. Planning/shape checks ONLY.
 *
 * IMPORTANT: expectedHosts and claimedInventory arrive as untrusted data
 * at this boundary. Neither a claimed source label nor matching digests
 * authenticate a deployment controller, OS collector, or Consumer ACK.
 * This module NEVER grants production release authorization.
 */
import {
  listRequiredCutoverEvidence,
  type WriterCutoverEvidenceScope,
  type WriterCutoverPhase
} from "./recovery-writer-cutover-evidence-coverage.js";
import type { WriterReleaseCheck } from "./recovery-writer-release-evidence.js";

export interface Day91ClaimedInventorySnapshot {
  readonly snapshotId: string;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
  /** Caller-supplied claim, not evidence of an authenticated principal. */
  readonly claimedSource: "deployment_controller" | "worker";
  readonly hosts: ReadonlyArray<{
    readonly hostId: string;
    readonly mountNamespaceId: string;
  }>;
}

export type Day91ProvenanceRequirement =
  | Readonly<{
      source: "trusted_deployment_inventory";
      verification: "authenticated_controller_and_immutable_snapshot";
    }>
  | Readonly<{
      source: "signed_host_collector";
      hostId: string;
      mountNamespaceId: string;
      phase: WriterCutoverPhase;
      check: WriterReleaseCheck;
      verification: "pinned_ed25519_key_single_use_challenge_and_os_observation";
    }>
  | Readonly<{
      source: "authenticated_consumer_ack";
      verification: "consumer_peer_attempt_binding_and_raw_ingress_cutover";
    }>;

export interface Day91ProvenancePlanInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly claimedInventory: Day91ClaimedInventorySnapshot | null;
}

export interface Day91ProvenancePlan {
  readonly action: "hold";
  readonly reasons: ReadonlyArray<string>;
  readonly hostCheckSlots: number;
  readonly requirements: ReadonlyArray<Day91ProvenanceRequirement>;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

const nonempty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

function hold(
  reasons: string[],
  requirements: ReadonlyArray<Day91ProvenanceRequirement> = [],
  slots = 0
): Day91ProvenancePlan {
  return {
    action: "hold", reasons, hostCheckSlots: slots, requirements,
    authenticatedEvidenceCount: 0, publishAuthorized: false
  };
}

/** Validate inventory metadata against a *claimed* plan; not authenticity. */
function candidateMatches(
  inventory: Day91ClaimedInventorySnapshot,
  scope: WriterCutoverEvidenceScope
): boolean {
  if (!inventory || !nonempty(inventory.snapshotId) ||
      inventory.deploymentId !== scope.deploymentId ||
      inventory.releaseId !== scope.releaseId ||
      inventory.attemptId !== scope.attemptId ||
      !Array.isArray(inventory.hosts) ||
      inventory.hosts.length !== scope.expectedHosts.length) return false;

  const actual = new Map<string, string>();
  for (const host of inventory.hosts) {
    if (!host || !nonempty(host.hostId) ||
        !nonempty(host.mountNamespaceId) || actual.has(host.hostId)) {
      return false;
    }
    actual.set(host.hostId, host.mountNamespaceId);
  }
  return scope.expectedHosts.every(host =>
    actual.get(host.hostId) === host.mountNamespaceId);
}

/**
 * Enumerate the external trust interfaces required before Day 90 blockers
 * could ever be evaluated with genuine evidence. There is intentionally
 * no "ready"/GO branch, including for a plausible claimed inventory.
 */
export function planDay91CutoverProvenance(
  input: Day91ProvenancePlanInput
): Day91ProvenancePlan {
  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release")) return hold(["intent_invalid"]);
  const scope = input.scope;
  if (!scope || !nonempty(scope.deploymentId) ||
      !nonempty(scope.releaseId) || !nonempty(scope.attemptId) ||
      !Array.isArray(scope.expectedHosts) ||
      scope.expectedHosts.length === 0 || scope.expectedHosts.length > 256) {
    return hold(["scope_invalid"]);
  }

  const ids = new Set<string>();
  for (const host of scope.expectedHosts) {
    if (!host || !nonempty(host.hostId) ||
        !nonempty(host.mountNamespaceId) || ids.has(host.hostId)) {
      return hold(["scope_host_invalid_or_duplicate"]);
    }
    ids.add(host.hostId);
  }

  const needed = listRequiredCutoverEvidence(scope);
  const requirements: Day91ProvenanceRequirement[] = [
    {
      source: "trusted_deployment_inventory",
      verification: "authenticated_controller_and_immutable_snapshot"
    },
    ...needed.map(item => ({
      source: "signed_host_collector" as const,
      hostId: item.hostId,
      mountNamespaceId: item.mountNamespaceId,
      phase: item.phase,
      check: item.check,
      verification: "pinned_ed25519_key_single_use_challenge_and_os_observation" as const
    })),
    {
      source: "authenticated_consumer_ack",
      verification: "consumer_peer_attempt_binding_and_raw_ingress_cutover"
    }
  ];

  const reasons = [
    "trusted_deployment_inventory_adapter_missing",
    "full_host_os_attestation_and_challenge_chain_missing",
    "authenticated_consumer_ack_missing",
    "independent_audit_anchor_missing"
  ];
  if (input.intent === "production_release") {
    reasons.unshift("production_release_not_authorized");
  }
  if (input.claimedInventory === null) {
    reasons.push("inventory_candidate_missing");
  } else if (!candidateMatches(input.claimedInventory, scope)) {
    reasons.push("inventory_candidate_scope_mismatch");
  } else {
    reasons.push("inventory_candidate_matches_but_source_not_authenticated");
  }
  return hold(reasons, requirements, needed.length);
}
