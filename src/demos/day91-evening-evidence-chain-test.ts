import { strict as assert } from "node:assert";
import {
  reviewDay91EvidenceChain,
  type Day91ConsumerAckCandidate,
  type Day91EvidenceChainInput
} from "../runtime/recovery-writer-cutover-evidence-chain.js";
import {
  listRequiredCutoverEvidence,
  type WriterCutoverEvidenceReceipt
} from "../runtime/recovery-writer-cutover-evidence-coverage.js";

const now = Date.UTC(2026, 10, 20, 10, 0, 0);
const scope = {
  deploymentId: "staging:day91",
  releaseId: "release-91",
  attemptId: "attempt-91-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const snapshot = {
  snapshotId: "fixture-91",
  revision: "r1",
  deploymentId: scope.deploymentId,
  releaseId: scope.releaseId,
  attemptId: scope.attemptId,
  hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 1_000,
  expiresAtEpochMs: now + 60_000
};
const ack: Day91ConsumerAckCandidate = {
  deploymentId: scope.deploymentId,
  releaseId: scope.releaseId,
  attemptId: scope.attemptId,
  consumerId: "demo-consumer",
  receivedAtEpochMs: now - 100,
  rawIngressClosed: true,
  claimedAuthenticated: true
};
const receipts: WriterCutoverEvidenceReceipt[] =
  listRequiredCutoverEvidence(scope).map(slot => ({
    ...slot,
    deploymentId: scope.deploymentId,
    releaseId: scope.releaseId,
    attemptId: scope.attemptId,
    status: "pass",
    observerKind: "independent_host_probe",
    observerId: "fake-observer",
    observedAtEpochMs: now - (slot.phase === "preflight" ? 20_000 : 10_000),
    artifactSha256: "a".repeat(64)
  }));
const base: Day91EvidenceChainInput = {
  intent: "isolated_review",
  scope,
  expectedAnchor: { snapshotId: "fixture-91", revision: "r1" },
  nowEpochMs: now,
  inventoryAdapter: { async readSnapshot() { return snapshot; } },
  hostReceipts: receipts,
  consumerAck: ack,
  observedFixtureHazards: [
    "old_fd_writable_after_chmod",
    "rollback_restores_new_write_access"
  ]
};

async function check(
  input: Day91EvidenceChainInput,
  source: "inventory" | "hostCollector" | "consumerAck",
  reason: string
): Promise<void> {
  const decision = await reviewDay91EvidenceChain(input);
  assert.equal(decision.action, "hold");
  assert.equal(decision.publishAuthorized, false);
  assert.equal(decision.authenticatedEvidenceCount, 0);
  assert.equal(decision.sources[source], reason);
  assert.equal(decision.requiredHostCheckSlots, 28);
  assert.equal(decision.requiredSourceTasks, 30);
}

await check(base, "inventory", "inventory_candidate_matched_but_source_unverified");
await check(base, "hostCollector", "host_coverage_only_metadata_unverified");
await check(base, "consumerAck", "consumer_ack_candidate_unverified");
const all = await reviewDay91EvidenceChain(base);
assert.equal(all.inventoryCandidateMatched, true);
assert.equal(all.hostReceiptCandidates, 28);
assert.ok(all.reasons.includes("external_audit_anchor_missing"));
assert.ok(all.reasons.includes(
  "reproduced_unsafe_fixture:old_fd_writable_after_chmod"));
assert.ok(all.reasons.includes(
  "reproduced_unsafe_fixture:rollback_restores_new_write_access"));

await check({ ...base, inventoryAdapter: null }, "inventory",
  "inventory_adapter_not_connected");
await check({ ...base, inventoryAdapter: {
  async readSnapshot() { return { ...snapshot, revision: "r2" }; }
} }, "inventory", "inventory_snapshot_anchor_mismatch");
await check({ ...base, inventoryAdapter: {
  async readSnapshot() {
    return { ...snapshot, hosts: [
      ...scope.expectedHosts, { hostId: "host-C", mountNamespaceId: "mnt:[1003]" }
    ] };
  }
} }, "inventory", "inventory_target_set_drift");
await check({ ...base, hostReceipts: [] }, "hostCollector",
  "host_evidence_receipt_missing:preflight:host-A:legacy_processes_exited");
await check({ ...base, hostReceipts: [receipts[0], receipts[0]] },
  "hostCollector", "host_evidence_receipt_duplicate");
await check({ ...base, hostReceipts: receipts.map((r, i) =>
  i === 0 ? { ...r, attemptId: "other-attempt" } : r
) }, "hostCollector", "host_evidence_receipt_target_or_attempt_mismatch");
await check({ ...base, consumerAck: null }, "consumerAck",
  "consumer_ack_missing");
await check({ ...base, consumerAck: { ...ack, attemptId: "other" } },
  "consumerAck", "consumer_ack_scope_mismatch");
await check({ ...base, consumerAck: { ...ack, rawIngressClosed: false } },
  "consumerAck", "raw_ack_ingress_not_proven_closed");
await check({ ...base, consumerAck: { ...ack, receivedAtEpochMs: now - 500_000 } },
  "consumerAck", "consumer_ack_identity_or_time_invalid");
await check({ ...base, consumerAck: { ...ack, claimedAuthenticated: false } },
  "consumerAck", "consumer_ack_candidate_unverified");

const prod = await reviewDay91EvidenceChain({
  ...base, intent: "production_release"
});
assert.ok(prod.reasons.includes("production_release_not_authorized"));
assert.equal(prod.action, "hold");
assert.equal(prod.publishAuthorized, false);

console.log("PASS Day 91 evening: 30-source chain, drift, fake receipts and ACK fail closed.");
console.log("LIMIT: all sources are fixture claims; no signed OS evidence or real Consumer ACK. NO_GO.");
