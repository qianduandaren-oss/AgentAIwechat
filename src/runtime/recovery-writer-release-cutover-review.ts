/**
 * Day 86 evening: advisory, FAIL-CLOSED cutover rehearsal review.
 * This composes Day 86 morning's evidence-envelope contract with an observed
 * instance inventory and a rollback manifest. All inputs are untrusted metadata.
 * It NEVER authenticates a host or authorizes a production release.
 */
import {
  reviewWriterReleaseEvidence,
  type WriterReleaseEvidenceEnvelope
} from "./recovery-writer-release-evidence.js";

export interface WriterCutoverInstance {
  readonly instanceId: string;
  readonly role: "trust_bound_writer" | "legacy_writer" | "reader";
  readonly active: boolean;
  readonly dbWritable: boolean;
}

export interface WriterCutoverInventory {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly observerKind: "independent_host_probe" | "worker_self_report";
  readonly observedAtEpochMs: number;
  readonly inventoryComplete: boolean;
  readonly rawAckIngressEnabled: boolean;
  readonly instances: ReadonlyArray<WriterCutoverInstance>;
}

export interface WriterCutoverRollbackManifest {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly imageDigestSha256: string;
  readonly legacyImageAllowed: boolean;
  readonly legacyWritableMountRestored: boolean;
  readonly rawAckIngressRestored: boolean;
  readonly unfencedConstructorAllowed: boolean;
}

export interface WriterCutoverReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly nowEpochMs: number;
  readonly evidence: WriterReleaseEvidenceEnvelope | null;
  readonly inventory: WriterCutoverInventory | null;
  readonly rollback: WriterCutoverRollbackManifest | null;
}

export type WriterCutoverReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_cutover_rehearsal"; publishAuthorized: false }>;

const hold = (reason: string): WriterCutoverReview => ({
  action: "hold", reason, publishAuthorized: false
});

const sha256 = (s: string): boolean => /^[a-f0-9]{64}$/.test(s);
const fresh = (observed: number, now: number): boolean =>
  Number.isSafeInteger(observed) && Number.isSafeInteger(now) &&
  observed <= now && now - observed <= 5 * 60_000;

/**
 * Run at BOTH preflight and the actual rehearsal decision point: evidence
 * can expire between those moments. A pass means only that the supplied
 * fixture metadata is internally consistent, not that OS permissions hold.
 */
export function reviewWriterCutoverRehearsal(
  input: WriterCutoverReviewInput
): WriterCutoverReview {
  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release")) return hold("intent_invalid");
  if (input.intent === "production_release") {
    return hold("production_cutover_not_independently_attested");
  }

  const evidenceReview = reviewWriterReleaseEvidence({
    intent: "isolated_review",
    deploymentId: input.deploymentId,
    releaseId: input.releaseId,
    nowEpochMs: input.nowEpochMs,
    evidence: input.evidence
  });
  if (evidenceReview.action === "hold") {
    return hold("release_evidence:" + evidenceReview.reason);
  }

  const inventory = input.inventory;
  if (!inventory) return hold("inventory_missing");
  if (inventory.deploymentId !== input.deploymentId ||
      inventory.releaseId !== input.releaseId) return hold("inventory_target_mismatch");
  if (inventory.observerKind !== "independent_host_probe" ||
      !inventory.inventoryComplete) return hold("inventory_not_independently_complete");
  if (!fresh(inventory.observedAtEpochMs, input.nowEpochMs)) {
    return hold("inventory_stale_or_clock_invalid");
  }
  if (inventory.rawAckIngressEnabled !== false) return hold("raw_ack_ingress_still_enabled");
  if (!Array.isArray(inventory.instances)) return hold("inventory_instances_missing");

  const ids = new Set<string>();
  for (const instance of inventory.instances) {
    if (!instance || !instance.instanceId?.trim() || ids.has(instance.instanceId) ||
        !["trust_bound_writer", "legacy_writer", "reader"].includes(instance.role) ||
        typeof instance.active !== "boolean" ||
        typeof instance.dbWritable !== "boolean") {
      return hold("inventory_instance_invalid_or_duplicate");
    }
    ids.add(instance.instanceId);
    if (instance.active && instance.role === "legacy_writer") {
      return hold("legacy_writer_still_active");
    }
    if (instance.dbWritable && (!instance.active ||
        instance.role !== "trust_bound_writer")) {
      return hold("untrusted_or_inactive_database_writer");
    }
  }
  const activeTrusted = inventory.instances.filter(i =>
    i.active && i.role === "trust_bound_writer" && i.dbWritable);
  if (activeTrusted.length !== 1) return hold("trusted_writer_cardinality_invalid");

  const rollback = input.rollback;
  if (!rollback) return hold("rollback_manifest_missing");
  if (rollback.deploymentId !== input.deploymentId ||
      rollback.releaseId !== input.releaseId) return hold("rollback_target_mismatch");
  if (!sha256(rollback.imageDigestSha256)) return hold("rollback_image_digest_invalid");
  if (rollback.legacyImageAllowed) return hold("rollback_legacy_image_allowed");
  if (rollback.legacyWritableMountRestored) return hold("rollback_legacy_mount_restored");
  if (rollback.rawAckIngressRestored) return hold("rollback_raw_ack_restored");
  if (rollback.unfencedConstructorAllowed) return hold("rollback_unfenced_constructor_allowed");

  return { action: "ready_for_isolated_cutover_rehearsal", publishAuthorized: false };
}
