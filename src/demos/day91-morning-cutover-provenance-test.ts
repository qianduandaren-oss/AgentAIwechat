import { strict as assert } from "node:assert";
import {
  planDay91CutoverProvenance,
  type Day91ClaimedInventorySnapshot,
  type Day91ProvenancePlanInput
} from "../runtime/recovery-writer-cutover-evidence-provenance.js";

const scope = {
  deploymentId: "staging:day91",
  releaseId: "release-91",
  attemptId: "attempt-91-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};

const inventory: Day91ClaimedInventorySnapshot = {
  snapshotId: "snapshot-from-untrusted-test",
  deploymentId: scope.deploymentId,
  releaseId: scope.releaseId,
  attemptId: scope.attemptId,
  claimedSource: "deployment_controller",
  hosts: [...scope.expectedHosts]
};
const base: Day91ProvenancePlanInput = {
  intent: "isolated_review", scope, claimedInventory: inventory
};
const planned = planDay91CutoverProvenance(base);
assert.equal(planned.action, "hold");
assert.equal(planned.hostCheckSlots, 28);
assert.equal(planned.requirements.length, 30); // inventory + 28 OS checks + ACK
assert.equal(planned.requirements.filter(x =>
  x.source === "signed_host_collector").length, 28);
assert.ok(planned.reasons.includes(
  "inventory_candidate_matches_but_source_not_authenticated"));
assert.equal(planned.authenticatedEvidenceCount, 0);
assert.equal(planned.publishAuthorized, false);

const none = planDay91CutoverProvenance({ ...base, claimedInventory: null });
assert.ok(none.reasons.includes("inventory_candidate_missing"));
assert.equal(none.hostCheckSlots, 28);
const production = planDay91CutoverProvenance({
  ...base, intent: "production_release"
});
assert.ok(production.reasons.includes("production_release_not_authorized"));
assert.equal(production.publishAuthorized, false);

function mismatch(snapshot: Day91ClaimedInventorySnapshot): void {
  const result = planDay91CutoverProvenance({
    ...base, claimedInventory: snapshot
  });
  assert.ok(result.reasons.includes("inventory_candidate_scope_mismatch"));
  assert.equal(result.publishAuthorized, false);
}
mismatch({ ...inventory, attemptId: "another-attempt" });
mismatch({ ...inventory, hosts: [scope.expectedHosts[0]] });
mismatch({ ...inventory, hosts: [
  scope.expectedHosts[0], { hostId: "host-B", mountNamespaceId: "mnt:[wrong]" }
] });
mismatch({ ...inventory, hosts: [
  scope.expectedHosts[0], scope.expectedHosts[0]
] });
mismatch({ ...inventory, snapshotId: "" });
assert.deepEqual(planDay91CutoverProvenance({
  ...base, scope: { ...scope, expectedHosts: [
    scope.expectedHosts[0], scope.expectedHosts[0]
  ] }
}).reasons, ["scope_host_invalid_or_duplicate"]);
assert.deepEqual(planDay91CutoverProvenance({
  ...base, scope: { ...scope, expectedHosts: [] }
}).reasons, ["scope_invalid"]);

// A forged "deployment_controller" string does not change the trust boundary.
const spoofed = planDay91CutoverProvenance({
  ...base, claimedInventory: { ...inventory, claimedSource: "deployment_controller" }
});
assert.equal(spoofed.authenticatedEvidenceCount, 0);
assert.equal(spoofed.action, "hold");

console.log("PASS Day 91 morning: 30 source tasks/28 host slots and fail-closed inventory mismatch.");
console.log("LIMIT: controller labels and host lists are untrusted; no OS attestations or ACK. Production NO_GO.");
