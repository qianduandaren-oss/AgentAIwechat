import { strict as assert } from "node:assert";
import {
  WRITER_RELEASE_CHECKS,
  type WriterReleaseEvidenceEnvelope
} from "../runtime/recovery-writer-release-evidence.js";
import {
  reviewWriterCutoverRehearsal,
  type WriterCutoverReviewInput
} from "../runtime/recovery-writer-release-cutover-review.js";

const now = Date.UTC(2026, 10, 15, 10, 0, 0);
const evidence: WriterReleaseEvidenceEnvelope = {
  deploymentId: "staging:day86",
  releaseId: "release-fixture-86",
  observerKind: "independent_host_probe",
  observerId: "fixture-control-plane-not-authenticated",
  observedAtEpochMs: now - 1000,
  observations: WRITER_RELEASE_CHECKS.map((check, i) => ({
    check, status: "pass", artifactSha256: String(i).repeat(64)
  }))
};
const good: WriterCutoverReviewInput = {
  intent: "isolated_review",
  deploymentId: evidence.deploymentId,
  releaseId: evidence.releaseId,
  nowEpochMs: now,
  evidence,
  inventory: {
    deploymentId: evidence.deploymentId,
    releaseId: evidence.releaseId,
    observerKind: "independent_host_probe",
    observedAtEpochMs: now - 1000,
    inventoryComplete: true,
    rawAckIngressEnabled: false,
    instances: [
      { instanceId: "writer-new", role: "trust_bound_writer", active: true, dbWritable: true },
      { instanceId: "reader-1", role: "reader", active: true, dbWritable: false }
    ]
  },
  rollback: {
    deploymentId: evidence.deploymentId,
    releaseId: evidence.releaseId,
    imageDigestSha256: "a".repeat(64),
    legacyImageAllowed: false,
    legacyWritableMountRestored: false,
    rawAckIngressRestored: false,
    unfencedConstructorAllowed: false
  }
};
const ready = {
  action: "ready_for_isolated_cutover_rehearsal", publishAuthorized: false
};
assert.deepEqual(reviewWriterCutoverRehearsal(good), ready);

function reject(input: WriterCutoverReviewInput, reason: string): void {
  assert.deepEqual(reviewWriterCutoverRehearsal(input), {
    action: "hold", reason, publishAuthorized: false
  });
}
reject({ ...good, intent: "production_release" },
  "production_cutover_not_independently_attested");
reject({ ...good, evidence: null }, "release_evidence:evidence_missing");
reject({ ...good, nowEpochMs: now + 300_001 },
  "release_evidence:evidence_stale_or_clock_invalid");
reject({ ...good, evidence: {
  ...evidence, observations: evidence.observations.map((o, i) =>
    i === 3 ? { ...o, status: "unknown" as const } : o)
} }, "release_evidence:check_not_proven:legacy_remount_denied");
reject({ ...good, inventory: null }, "inventory_missing");
reject({ ...good, inventory: { ...good.inventory!, releaseId: "other-release" } },
  "inventory_target_mismatch");
reject({ ...good, inventory: { ...good.inventory!, observerKind: "worker_self_report" } },
  "inventory_not_independently_complete");
reject({ ...good, inventory: { ...good.inventory!, inventoryComplete: false } },
  "inventory_not_independently_complete");
reject({ ...good, inventory: { ...good.inventory!, observedAtEpochMs: now - 300_001 } },
  "inventory_stale_or_clock_invalid");
reject({ ...good, inventory: { ...good.inventory!, rawAckIngressEnabled: true } },
  "raw_ack_ingress_still_enabled");
reject({ ...good, inventory: { ...good.inventory!, instances: [
  ...good.inventory!.instances, good.inventory!.instances[0]
] } }, "inventory_instance_invalid_or_duplicate");
reject({ ...good, inventory: { ...good.inventory!, instances: [
  ...good.inventory!.instances,
  { instanceId: "old-writer", role: "legacy_writer", active: true, dbWritable: false }
] } }, "legacy_writer_still_active");
reject({ ...good, inventory: { ...good.inventory!, instances: [
  ...good.inventory!.instances,
  { instanceId: "old-write", role: "legacy_writer", active: false, dbWritable: true }
] } }, "untrusted_or_inactive_database_writer");
reject({ ...good, inventory: { ...good.inventory!, instances: [
  ...good.inventory!.instances,
  { instanceId: "writer-two", role: "trust_bound_writer", active: true, dbWritable: true }
] } }, "trusted_writer_cardinality_invalid");
reject({ ...good, inventory: { ...good.inventory!, instances: [
  { instanceId: "reader-1", role: "reader", active: true, dbWritable: false }
] } }, "trusted_writer_cardinality_invalid");
reject({ ...good, rollback: null }, "rollback_manifest_missing");
reject({ ...good, rollback: { ...good.rollback!, releaseId: "rollback-other" } },
  "rollback_target_mismatch");
reject({ ...good, rollback: { ...good.rollback!, imageDigestSha256: "not-a-sha" } },
  "rollback_image_digest_invalid");
reject({ ...good, rollback: { ...good.rollback!, legacyImageAllowed: true } },
  "rollback_legacy_image_allowed");
reject({ ...good, rollback: { ...good.rollback!, legacyWritableMountRestored: true } },
  "rollback_legacy_mount_restored");
reject({ ...good, rollback: { ...good.rollback!, rawAckIngressRestored: true } },
  "rollback_raw_ack_restored");
reject({ ...good, rollback: { ...good.rollback!, unfencedConstructorAllowed: true } },
  "rollback_unfenced_constructor_allowed");

console.log("PASS Day 86 evening: mixed-version, stale evidence, inventory, raw ACK, rollback manifest all HOLD as expected.");
console.log("PASS synthetic complete fixture => isolated cutover rehearsal ONLY; publishAuthorized=false.");
console.log("LIMIT: input arrays and observer labels are untrusted; no production OS/mount/FD/rollback attestation or Consumer ACK. NO_GO.");
