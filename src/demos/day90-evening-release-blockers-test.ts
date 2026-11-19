import { strict as assert } from "node:assert";
import {
  reviewDay90ReleaseBlockers, type Day90ReleaseBlockerInput
} from "../runtime/recovery-writer-cutover-release-blockers.js";
import {
  listRequiredCutoverEvidence, type WriterCutoverEvidenceReceipt
} from "../runtime/recovery-writer-cutover-evidence-coverage.js";

const now = Date.UTC(2026, 10, 19, 10);
const scope = {
  deploymentId: "staging:day90-evening",
  releaseId: "release-90",
  attemptId: "attempt-90-evening",
  expectedHosts: [
    { hostId: "host-a", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-b", mountNamespaceId: "mnt:[1002]" }
  ]
};
const base: Day90ReleaseBlockerInput = {
  intent: "isolated_review", scope, nowEpochMs: now,
  receipts: [], localSignals: [], observedFixtureHazards: [
    "old_fd_writable_after_chmod",
    "rollback_restores_new_write_access"
  ]
};
const review = reviewDay90ReleaseBlockers(base);
assert.equal(review.action, "hold");
assert.equal(review.unknownCells, 28);
assert.equal(review.independentlyAttestedReceiptCount, 0);
assert.equal(review.publishAuthorized, false);
assert.ok(review.reasons.some(s => s.startsWith("coverage:receipt_missing:")));
assert.ok(review.reasons.includes("reproduced_unsafe_fixture:old_fd_writable_after_chmod"));
assert.ok(review.reasons.includes("reproduced_unsafe_fixture:rollback_restores_new_write_access"));

const receipts: WriterCutoverEvidenceReceipt[] =
  listRequiredCutoverEvidence(scope).map((item, i) => ({
    ...item, deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, status: "pass",
    observerKind: "independent_host_probe",
    observerId: "forged-test-label-not-trusted",
    observedAtEpochMs: now - (item.phase === "preflight" ? 2000 : 1000),
    artifactSha256: String(i % 10).repeat(64)
  }));
const synthetic = reviewDay90ReleaseBlockers({
  ...base, receipts, observedFixtureHazards: []
});
assert.equal(synthetic.action, "hold");
assert.equal(synthetic.callerSuppliedReceiptCount, 28);
assert.equal(synthetic.independentlyAttestedReceiptCount, 0);
assert.equal(synthetic.unknownCells, 28);
assert.ok(synthetic.reasons.includes("coverage_is_only_untrusted_metadata"));
assert.ok(synthetic.reasons.includes("pinned_collector_signature_and_atomic_challenge_chain_missing"));
assert.ok(synthetic.reasons.includes("independent_consumer_ack_and_raw_ingress_proof_missing"));

function expectCoverageHold(
  changed: Partial<Day90ReleaseBlockerInput>, fragment: string
): void {
  const result = reviewDay90ReleaseBlockers({ ...base, ...changed });
  assert.equal(result.publishAuthorized, false);
  assert.ok(result.reasons.includes("coverage:" + fragment),
    "missing coverage blocker " + fragment + ": " + result.reasons.join(", "));
}

expectCoverageHold({ receipts: receipts.slice(1) },
  "receipt_missing:preflight:host-a:legacy_processes_exited");
expectCoverageHold({ receipts: [...receipts, receipts[0]] },
  "receipt_duplicate");
expectCoverageHold({ receipts: receipts.map((r, i) =>
  i === 0 ? { ...r, attemptId: "wrong-attempt" } : r) },
  "receipt_target_or_attempt_mismatch");
expectCoverageHold({ receipts: receipts.map((r, i) =>
  i === 0 ? { ...r, observerKind: "worker_self_report" as const } : r) },
  "receipt_observer_untrusted");
const cutoverIndex = receipts.findIndex(r => r.phase === "cutover" &&
  r.hostId === "host-a" && r.check === "legacy_processes_exited");
expectCoverageHold({ receipts: receipts.map((r, i) =>
  i === cutoverIndex ? { ...r, observedAtEpochMs: now - 3000 } : r) },
  "cutover_not_after_preflight");

const fixture = reviewDay90ReleaseBlockers({
  ...base, localSignals: [{
    kind: "day86_owned_child_writable_sqlite_fd",
    phase: "preflight", hostId: "host-a", mountNamespaceId: "mnt:[1001]",
    observedAtEpochMs: now - 300, rawArtifactSha256: "f".repeat(64)
  }]
});
assert.equal(fixture.unknownCells, 28);
assert.ok(fixture.reasons.includes("disposable_lab_signals_not_deployment_receipts"));

const production = reviewDay90ReleaseBlockers({
  ...base, intent: "production_release", receipts
});
assert.ok(production.reasons.includes("production_release_not_authorized"));
assert.equal(production.publishAuthorized, false);

const malformed = reviewDay90ReleaseBlockers({
  ...base, observedFixtureHazards: ["unexpected_claim" as any]
});
assert.deepEqual(malformed.reasons, ["review_input_invalid"]);
const badScope = reviewDay90ReleaseBlockers({
  ...base, scope: { ...scope, expectedHosts: [] }
});
assert.deepEqual(badScope.reasons, ["scope_or_local_lab_invalid"]);

console.log("PASS Day 90 evening: missing host, wrong attempt, replayed phase, duplicate and worker claims all HOLD.");
console.log("PASS synthetic 28 PASS receipts and real disposable lab hazards never authorize release. Production NO_GO.");
