import { strict as assert } from "node:assert";
import {
  WRITER_RELEASE_CHECKS,
  reviewWriterReleaseEvidence,
  type WriterReleaseEvidenceEnvelope,
  type WriterReleaseEvidenceReviewInput
} from "../runtime/recovery-writer-release-evidence.js";

const now = Date.UTC(2026, 10, 15, 0, 0, 0);
const valid: WriterReleaseEvidenceEnvelope = {
  deploymentId: "staging:day86",
  releaseId: "release-test-86",
  observerId: "fixture-independent-host",
  observerKind: "independent_host_probe",
  observedAtEpochMs: now - 1_000,
  observations: WRITER_RELEASE_CHECKS.map((check, index) => ({
    check, status: "pass", artifactSha256: String(index % 10).repeat(64)
  }))
};
const base: WriterReleaseEvidenceReviewInput = {
  intent: "isolated_review",
  deploymentId: valid.deploymentId,
  releaseId: valid.releaseId,
  nowEpochMs: now,
  evidence: valid
};
assert.deepEqual(reviewWriterReleaseEvidence(base), {
  action: "ready_for_isolated_deployment_probe", publishAuthorized: false
});

function reject(input: WriterReleaseEvidenceReviewInput, reason: string): void {
  assert.deepEqual(reviewWriterReleaseEvidence(input), {
    action: "hold", reason, publishAuthorized: false
  });
}
reject({ ...base, intent: "production_release" }, "production_isolation_not_independently_verified");
reject({ ...base, evidence: null }, "evidence_missing");
reject({ ...base, evidence: { ...valid, deploymentId: "other" } }, "evidence_target_mismatch");
reject({ ...base, evidence: { ...valid, releaseId: "other" } }, "evidence_target_mismatch");
reject({ ...base, evidence: { ...valid, observerKind: "worker_self_report" } }, "independent_observer_missing");
reject({ ...base, evidence: { ...valid, observedAtEpochMs: now - 300_001 } }, "evidence_stale_or_clock_invalid");
reject({ ...base, evidence: { ...valid, observedAtEpochMs: now + 1 } }, "evidence_stale_or_clock_invalid");
reject({ ...base, evidence: { ...valid, observations: valid.observations.slice(1) } },
  "check_missing:legacy_processes_exited");
reject({ ...base, evidence: { ...valid, observations: [...valid.observations, valid.observations[0]] } },
  "duplicate_or_unknown_check");
reject({ ...base, evidence: { ...valid, observations: valid.observations.map((o, i) =>
  i === 1 ? { ...o, status: "unknown" as const } : o) } },
  "check_not_proven:legacy_writable_fds_drained");
reject({ ...base, evidence: { ...valid, observations: valid.observations.map((o, i) =>
  i === 2 ? { ...o, status: "fail" as const } : o) } },
  "check_not_proven:legacy_db_wal_shm_denied");
reject({ ...base, evidence: { ...valid, observations: valid.observations.map((o, i) =>
  i === 3 ? { ...o, artifactSha256: "not-a-digest" } : o) } },
  "artifact_digest_invalid:legacy_remount_denied");
console.log("PASS Day 86 morning: release evidence completeness, binding, freshness and negative cases.");
console.log("LIMIT: synthetic evidence; no actual host observer, FD inventory, mount inspection, production ACK or publish authorization. NO_GO.");
