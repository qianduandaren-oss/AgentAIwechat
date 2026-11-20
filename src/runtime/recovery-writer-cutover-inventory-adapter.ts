/**
 * Day 91 noon: read-only deployment inventory adapter boundary.
 *
 * A caller-injected adapter is not itself authenticated. No transport peer
 * verification, immutable control-plane snapshot, or production GO is implied.
 * A matched result is a fixture candidate only; every path returns HOLD.
 */
import { planDay91CutoverProvenance } from "./recovery-writer-cutover-evidence-provenance.js";
import type {
  WriterCutoverEvidenceScope,
  WriterCutoverTargetHost
} from "./recovery-writer-cutover-evidence-coverage.js";

export interface Day91InventoryBinding {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
}

export interface Day91InventoryAnchor {
  readonly snapshotId: string;
  readonly revision: string;
}

/** Raw, unauthenticated candidate delivered by an injected reader. */
export interface Day91InventorySnapshot extends Day91InventoryBinding, Day91InventoryAnchor {
  readonly capturedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly hosts: ReadonlyArray<WriterCutoverTargetHost>;
}

/**
 * A production adapter would have to authenticate the controller peer,
 * validate immutable/versioned snapshot provenance and enforce authorization.
 * This interface does NONE of that; tests supply a memory-only reader.
 */
export interface Day91DeploymentInventoryAdapter {
  readSnapshot(binding: Day91InventoryBinding): Promise<Day91InventorySnapshot | null>;
}

export interface Day91InventoryReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  /** Caller-provided anchor for the isolated exercise, NOT a trusted pin. */
  readonly expectedAnchor: Day91InventoryAnchor;
  readonly nowEpochMs: number;
  readonly adapter: Day91DeploymentInventoryAdapter | null;
}

export interface Day91InventoryReviewResult {
  readonly action: "hold";
  readonly reason: string;
  readonly candidateMatched: boolean;
  readonly requiredHostCheckSlots: number;
  readonly requiredProvenanceTasks: number;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function matchesHosts(
  actual: unknown,
  expected: ReadonlyArray<WriterCutoverTargetHost>
): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const seen = new Map<string, string>();
  for (const host of actual) {
    if (!host || !nonempty(host.hostId) ||
        !nonempty(host.mountNamespaceId) || seen.has(host.hostId)) {
      return false;
    }
    seen.set(host.hostId, host.mountNamespaceId);
  }
  return expected.every(host => seen.get(host.hostId) === host.mountNamespaceId);
}

/**
 * Perform a read-only isolated inventory check. Even a match is UNTRUSTED.
 * In particular: do not promote candidateMatched to a release approval.
 */
export async function reviewDay91DeploymentInventory(
  input: Day91InventoryReviewInput
): Promise<Day91InventoryReviewResult> {
  const scope = input?.scope ?? {
    deploymentId: "", releaseId: "", attemptId: "", expectedHosts: []
  };
  const requirements = planDay91CutoverProvenance({
    intent: input?.intent ?? "isolated_review",
    scope,
    claimedInventory: null
  });

  const hold = (reason: string, candidateMatched = false): Day91InventoryReviewResult => ({
    action: "hold",
    reason,
    candidateMatched,
    requiredHostCheckSlots: requirements.hostCheckSlots,
    requiredProvenanceTasks: requirements.requirements.length,
    authenticatedEvidenceCount: 0,
    publishAuthorized: false
  });

  if (!input || (input.intent !== "isolated_review" &&
                 input.intent !== "production_release")) return hold("intent_invalid");
  if (requirements.requirements.length === 0) return hold("scope_invalid");
  if (input.intent === "production_release") return hold("production_release_not_authorized");
  if (!Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs <= 0) {
    return hold("review_clock_invalid");
  }
  if (!input.expectedAnchor || !nonempty(input.expectedAnchor.snapshotId) ||
      !nonempty(input.expectedAnchor.revision)) return hold("inventory_anchor_missing");
  if (!input.adapter || typeof input.adapter.readSnapshot !== "function") {
    return hold("inventory_adapter_not_connected");
  }

  let snapshot: Day91InventorySnapshot | null;
  try {
    snapshot = await input.adapter.readSnapshot({
      deploymentId: scope.deploymentId,
      releaseId: scope.releaseId,
      attemptId: scope.attemptId
    });
  } catch {
    return hold("inventory_adapter_read_failed");
  }
  if (!snapshot) return hold("inventory_snapshot_unavailable");
  if (!nonempty(snapshot.snapshotId) || !nonempty(snapshot.revision) ||
      snapshot.snapshotId !== input.expectedAnchor.snapshotId ||
      snapshot.revision !== input.expectedAnchor.revision) {
    return hold("inventory_snapshot_anchor_mismatch");
  }
  if (snapshot.deploymentId !== scope.deploymentId ||
      snapshot.releaseId !== scope.releaseId ||
      snapshot.attemptId !== scope.attemptId) {
    return hold("inventory_snapshot_scope_mismatch");
  }
  if (!Number.isSafeInteger(snapshot.capturedAtEpochMs) ||
      !Number.isSafeInteger(snapshot.expiresAtEpochMs) ||
      snapshot.capturedAtEpochMs > input.nowEpochMs ||
      snapshot.expiresAtEpochMs <= snapshot.capturedAtEpochMs) {
    return hold("inventory_snapshot_time_invalid");
  }
  if (snapshot.expiresAtEpochMs <= input.nowEpochMs ||
      input.nowEpochMs - snapshot.capturedAtEpochMs > 300_000) {
    return hold("inventory_snapshot_stale_or_expired");
  }
  if (!matchesHosts(snapshot.hosts, scope.expectedHosts)) {
    return hold("inventory_target_set_drift");
  }

  // This is an isolated fixture match, not a trusted inventory snapshot.
  // Host evidence and consumer ACK still have to be separately authenticated.
  return hold("inventory_candidate_matched_but_source_unverified", true);
}
