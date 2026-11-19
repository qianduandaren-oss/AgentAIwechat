import { strict as assert } from "node:assert";
import { WRITER_RELEASE_CHECKS } from "../runtime/recovery-writer-release-evidence.js";
import {
  listRequiredCutoverEvidence, reviewWriterCutoverEvidenceCoverage,
  type WriterCutoverEvidenceReceipt,
  type WriterCutoverCoverageInput
} from "../runtime/recovery-writer-cutover-evidence-coverage.js";

const now = Date.UTC(2026, 10, 19, 0, 0, 0);
const scope = {
  deploymentId: "staging:day90", releaseId: "release-day90",
  attemptId: "attempt-unique-90",
  expectedHosts: [
    { hostId: "host-1", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-2", mountNamespaceId: "mnt:[1002]" }
  ]
};
const items = listRequiredCutoverEvidence(scope);
assert.equal(items.length, 28);
const receipts: WriterCutoverEvidenceReceipt[] = items.map((item, index) => ({
  ...item, deploymentId: scope.deploymentId, releaseId: scope.releaseId,
  attemptId: scope.attemptId, observerKind: "independent_host_probe",
  observerId: "synthetic-fixture-not-authenticated", status: "pass",
  artifactSha256: String(index % 10).repeat(64),
  observedAtEpochMs: now - (item.phase === "preflight" ? 2000 : 1000)
}));
const base: WriterCutoverCoverageInput = {
  intent: "isolated_review", scope, nowEpochMs: now, receipts
};
assert.deepEqual(reviewWriterCutoverEvidenceCoverage(base), {
  action: "coverage_complete_for_isolated_attestation",
  receiptCount: 28, publishAuthorized: false
});
function hold(input: WriterCutoverCoverageInput, reason: string): void {
  assert.deepEqual(reviewWriterCutoverEvidenceCoverage(input), {
    action: "hold", reason, publishAuthorized: false
  });
}
hold({ ...base, intent: "production_release" }, "production_os_evidence_not_attested");
hold({ ...base, receipts: receipts.slice(1) },
  "receipt_missing:preflight:host-1:" + WRITER_RELEASE_CHECKS[0]);
hold({ ...base, receipts: [...receipts, receipts[0]] }, "receipt_duplicate");
hold({ ...base, scope: { ...scope, expectedHosts: [scope.expectedHosts[0], scope.expectedHosts[0]] } },
  "expected_host_invalid_or_duplicate");
hold({ ...base, receipts: receipts.map((r,i) =>
  i === 0 ? { ...r, attemptId: "other" } : r) }, "receipt_target_or_attempt_mismatch");
hold({ ...base, receipts: receipts.map((r,i) =>
  i === 0 ? { ...r, mountNamespaceId: "mnt:[wrong]" } : r) },
  "receipt_host_or_namespace_mismatch");
hold({ ...base, receipts: receipts.map((r,i) =>
  i === 0 ? { ...r, observerKind: "worker_self_report" as const } : r) },
  "receipt_observer_untrusted");
hold({ ...base, receipts: receipts.map((r,i) =>
  i === 0 ? { ...r, status: "unknown" as const } : r) },
  "receipt_not_proven:" + WRITER_RELEASE_CHECKS[0]);
hold({ ...base, receipts: receipts.map((r,i) =>
  i === 0 ? { ...r, observedAtEpochMs: now - 300001 } : r) },
  "receipt_stale_or_clock_invalid");
const cutoverIdx = receipts.findIndex(r => r.phase === "cutover" && r.hostId === "host-1" &&
  r.check === WRITER_RELEASE_CHECKS[0]);
hold({ ...base, receipts: receipts.map((r,i) =>
  i === cutoverIdx ? { ...r, observedAtEpochMs: now - 3000 } : r) },
  "cutover_not_after_preflight");
console.log("PASS Day 90 morning: per-host preflight/cutover coverage and fail-closed negatives.");
console.log("LIMIT: receipts are synthetic self-supplied metadata, no cryptographic or OS authentication. Production NO_GO.");
