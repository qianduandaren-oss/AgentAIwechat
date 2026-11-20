import { strict as assert } from "node:assert";
import {
  reviewDay91DeploymentInventory,
  type Day91DeploymentInventoryAdapter,
  type Day91InventoryReviewInput,
  type Day91InventorySnapshot
} from "../runtime/recovery-writer-cutover-inventory-adapter.js";

const now = Date.UTC(2026, 10, 20, 4, 0, 0);
const scope = {
  deploymentId: "staging:day91",
  releaseId: "release-91",
  attemptId: "attempt-91-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const snapshot: Day91InventorySnapshot = {
  snapshotId: "fixture-snapshot-91",
  revision: "r1",
  deploymentId: scope.deploymentId,
  releaseId: scope.releaseId,
  attemptId: scope.attemptId,
  capturedAtEpochMs: now - 1000,
  expiresAtEpochMs: now + 60_000,
  hosts: scope.expectedHosts
};
const bindingRequests: string[] = [];
const adapter = (item: Day91InventorySnapshot | null): Day91DeploymentInventoryAdapter => ({
  async readSnapshot(binding) {
    bindingRequests.push(JSON.stringify(binding));
    return item;
  }
});
const base: Day91InventoryReviewInput = {
  intent: "isolated_review", scope, nowEpochMs: now,
  expectedAnchor: { snapshotId: snapshot.snapshotId, revision: snapshot.revision },
  adapter: adapter(snapshot)
};

async function check(
  expected: string,
  overrides: Partial<Day91InventoryReviewInput> = {}
): Promise<void> {
  const result = await reviewDay91DeploymentInventory({ ...base, ...overrides });
  assert.equal(result.reason, expected);
  assert.equal(result.action, "hold");
  assert.equal(result.authenticatedEvidenceCount, 0);
  assert.equal(result.publishAuthorized, false);
}

const matched = await reviewDay91DeploymentInventory(base);
assert.equal(matched.reason, "inventory_candidate_matched_but_source_unverified");
assert.equal(matched.candidateMatched, true);
assert.equal(matched.requiredHostCheckSlots, 28);
assert.equal(matched.requiredProvenanceTasks, 30);
assert.equal(bindingRequests.length, 1);
assert.deepEqual(JSON.parse(bindingRequests[0]), {
  deploymentId: scope.deploymentId,
  releaseId: scope.releaseId,
  attemptId: scope.attemptId
});

await check("inventory_adapter_not_connected", { adapter: null });
await check("inventory_snapshot_unavailable", { adapter: adapter(null) });
await check("inventory_adapter_read_failed", {
  adapter: { async readSnapshot() { throw new Error("disconnected"); } }
});
await check("inventory_anchor_missing", {
  expectedAnchor: { snapshotId: "", revision: "r1" }
});
await check("inventory_snapshot_anchor_mismatch", {
  adapter: adapter({ ...snapshot, revision: "r2" })
});
await check("inventory_snapshot_anchor_mismatch", {
  adapter: adapter({ ...snapshot, snapshotId: "different-snapshot" })
});
await check("inventory_snapshot_scope_mismatch", {
  adapter: adapter({ ...snapshot, attemptId: "attempt-replayed" })
});
await check("inventory_snapshot_scope_mismatch", {
  adapter: adapter({ ...snapshot, releaseId: "another-release" })
});
await check("inventory_snapshot_stale_or_expired", {
  adapter: adapter({ ...snapshot, capturedAtEpochMs: now - 400_000 })
});
await check("inventory_snapshot_stale_or_expired", {
  adapter: adapter({ ...snapshot, expiresAtEpochMs: now })
});
await check("inventory_snapshot_time_invalid", {
  adapter: adapter({ ...snapshot, capturedAtEpochMs: now + 100 })
});
await check("inventory_target_set_drift", {
  adapter: adapter({ ...snapshot, hosts: [scope.expectedHosts[0]] })
});
await check("inventory_target_set_drift", {
  adapter: adapter({ ...snapshot, hosts: [
    ...scope.expectedHosts,
    { hostId: "host-C", mountNamespaceId: "mnt:[1003]" }
  ] })
});
await check("inventory_target_set_drift", {
  adapter: adapter({ ...snapshot, hosts: [
    scope.expectedHosts[0],
    { hostId: "host-B", mountNamespaceId: "mnt:[wrong]" }
  ] })
});
await check("inventory_target_set_drift", {
  adapter: adapter({ ...snapshot, hosts: [
    scope.expectedHosts[0], scope.expectedHosts[0]
  ] })
});
await check("review_clock_invalid", { nowEpochMs: NaN });
await check("scope_invalid", {
  scope: { ...scope, expectedHosts: [] }
});
await check("production_release_not_authorized", { intent: "production_release" });

// Simulate inventory changing after a pinned preflight: no new GO permission.
let live: Day91InventorySnapshot = snapshot;
const changingAdapter: Day91DeploymentInventoryAdapter = {
  async readSnapshot() { return live; }
};
await check("inventory_candidate_matched_but_source_unverified", {
  adapter: changingAdapter
});
live = { ...snapshot, revision: "r2", hosts: [
  ...scope.expectedHosts, { hostId: "host-C", mountNamespaceId: "mnt:[1003]" }
] };
await check("inventory_snapshot_anchor_mismatch", { adapter: changingAdapter });

// Even an extra claimedSource tag cannot authenticate a mock controller.
const spoofed = { ...snapshot, claimedSource: "deployment_controller", verified: true };
await check("inventory_candidate_matched_but_source_unverified", {
  adapter: adapter(spoofed)
});

console.log("PASS Day 91 noon: read-only inventory adapter, anchor/freshness/drift fail closed.");
console.log("LIMIT: injected fixture is not an authenticated deployment controller; NO_GO.");
