/**
 * Day 92 morning: deterministic INVENTORY FREEZE CANDIDATE, NOT an authenticated
 * deployment inventory, durable CAS, signed manifest, or production GO gate.
 * Caller-provided bytes can be perfectly hashed and still be fabricated.
 */
import { createHash } from "node:crypto";
import {
  reviewDay91DeploymentInventory,
  type Day91InventoryAnchor,
  type Day91InventorySnapshot
} from "./recovery-writer-cutover-inventory-adapter.js";
import type { WriterCutoverEvidenceScope } from
  "./recovery-writer-cutover-evidence-coverage.js";

export const DAY92_INVENTORY_MANIFEST_DOMAIN =
  "agent-ai/recovery/inventory-freeze/v1" as const;

export interface Day92FreezeCandidateInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly expectedAnchor: Day91InventoryAnchor;
  readonly snapshot: Day91InventorySnapshot | null;
  readonly nowEpochMs: number;
}

export interface Day92InventoryFreezeCandidate {
  readonly domain: typeof DAY92_INVENTORY_MANIFEST_DOMAIN;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
  readonly snapshotId: string;
  readonly revision: string;
  readonly capturedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly hostCount: number;
  /** Hash over domain-separated, canonical, complete candidate content. */
  readonly manifestSha256: string;
}

export interface Day92FreezeCandidateReview {
  readonly action: "hold";
  readonly reason: string;
  readonly candidate: Day92InventoryFreezeCandidate | null;
  readonly authenticatedInventoryCount: 0;
  readonly durableFreezeCommitted: false;
  readonly publishAuthorized: false;
}

const hold = (
  reason: string,
  candidate: Day92InventoryFreezeCandidate | null = null
): Day92FreezeCandidateReview => ({
  action: "hold", reason, candidate, authenticatedInventoryCount: 0,
  durableFreezeCommitted: false, publishAuthorized: false
});

/**
 * Establish a stable byte identity across host enumeration order.
 * This is NOT a signature. The Day 91 validation must run before this helper
 * so duplicate hosts, malformed timestamps, and scope drift are rejected.
 */
export function canonicalDay92InventoryManifestBytes(
  snapshot: Day91InventorySnapshot
): Uint8Array {
  const hosts = [...snapshot.hosts]
    .map(host => [host.hostId, host.mountNamespaceId])
    .sort((a, b) => a[0].localeCompare(b[0], "en"));
  const fields = [
    DAY92_INVENTORY_MANIFEST_DOMAIN,
    snapshot.deploymentId, snapshot.releaseId, snapshot.attemptId,
    snapshot.snapshotId, snapshot.revision,
    snapshot.capturedAtEpochMs, snapshot.expiresAtEpochMs, hosts
  ];
  return new TextEncoder().encode(JSON.stringify(fields));
}

/**
 * Prepare an *untrusted candidate*. We intentionally reuse the Day 91
 * strict read-only validation, with one captured snapshot and no fake
 * trustedSource flag. No adapter can promote this review to GO.
 */
export async function planDay92InventoryFreezeCandidate(
  input: Day92FreezeCandidateInput
): Promise<Day92FreezeCandidateReview> {
  if (!input || !input.snapshot) return hold("inventory_snapshot_unavailable");
  const reviewed = await reviewDay91DeploymentInventory({
    intent: input.intent,
    scope: input.scope,
    expectedAnchor: input.expectedAnchor,
    nowEpochMs: input.nowEpochMs,
    adapter: { async readSnapshot() { return input.snapshot; } }
  });
  if (!reviewed.candidateMatched) return hold(reviewed.reason);
  const snapshot = input.snapshot;
  const bytes = canonicalDay92InventoryManifestBytes(snapshot);
  const manifestSha256 = createHash("sha256").update(bytes).digest("hex");
  const candidate = Object.freeze({
    domain: DAY92_INVENTORY_MANIFEST_DOMAIN,
    deploymentId: snapshot.deploymentId,
    releaseId: snapshot.releaseId,
    attemptId: snapshot.attemptId,
    snapshotId: snapshot.snapshotId,
    revision: snapshot.revision,
    capturedAtEpochMs: snapshot.capturedAtEpochMs,
    expiresAtEpochMs: snapshot.expiresAtEpochMs,
    hostCount: snapshot.hosts.length,
    manifestSha256
  });
  return hold("authenticated_authority_and_durable_freeze_missing", candidate);
}
