import { strict as assert } from "node:assert";
import { planDay92InventoryFreezeCandidate } from
  "../runtime/recovery-writer-inventory-freeze-candidate.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const now = Date.UTC(2026, 10, 21, 0, 0, 0);
const scope = {
  deploymentId: "staging:day92",
  releaseId: "release-92",
  attemptId: "attempt-92-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const snapshot: Day91InventorySnapshot = {
  ...scope, snapshotId: "fixture-snapshot-92", revision: "r1",
  capturedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60_000,
  hosts: scope.expectedHosts
};
const base = {
  intent: "isolated_review" as const, scope, snapshot, nowEpochMs: now,
  expectedAnchor: { snapshotId: "fixture-snapshot-92", revision: "r1" }
};
const review = await planDay92InventoryFreezeCandidate(base);
assert.equal(review.action, "hold");
assert.equal(review.reason, "authenticated_authority_and_durable_freeze_missing");
assert.equal(review.candidate?.hostCount, 2);
assert.equal(review.candidate?.manifestSha256.length, 64);
assert.equal(review.authenticatedInventoryCount, 0);
assert.equal(review.durableFreezeCommitted, false);
assert.equal(review.publishAuthorized, false);

const shuffled = await planDay92InventoryFreezeCandidate({
  ...base, snapshot: { ...snapshot, hosts: [...snapshot.hosts].reverse() }
});
assert.equal(shuffled.candidate?.manifestSha256, review.candidate?.manifestSha256);

const changedAttempt = await planDay92InventoryFreezeCandidate({
  ...base,
  scope: { ...scope, attemptId: "attempt-92-02" },
  snapshot: { ...snapshot, attemptId: "attempt-92-02" }
});
assert.ok(changedAttempt.candidate?.manifestSha256 !== review.candidate?.manifestSha256);

const newerRevision = await planDay92InventoryFreezeCandidate({
  ...base,
  snapshot: { ...snapshot, revision: "r2" },
  expectedAnchor: { ...base.expectedAnchor, revision: "r2" }
});
assert.ok(newerRevision.candidate?.manifestSha256 !== review.candidate?.manifestSha256);

const changedHostScope = {
  ...scope, expectedHosts: [
    scope.expectedHosts[0], { hostId: "host-B", mountNamespaceId: "mnt:[9999]" }
  ]
};
const changedHost = await planDay92InventoryFreezeCandidate({
  ...base,
  scope: changedHostScope,
  snapshot: { ...snapshot, hosts: changedHostScope.expectedHosts }
});
assert.ok(changedHost.candidate?.manifestSha256 !== review.candidate?.manifestSha256);

async function holds(
  reason: string, overrides: Parameters<typeof planDay92InventoryFreezeCandidate>[0]
): Promise<void> {
  const result = await planDay92InventoryFreezeCandidate(overrides);
  assert.equal(result.action, "hold");
  assert.equal(result.reason, reason);
  assert.equal(result.candidate, null);
  assert.equal(result.publishAuthorized, false);
}
await holds("inventory_snapshot_unavailable", { ...base, snapshot: null });
await holds("inventory_snapshot_anchor_mismatch", {
  ...base, snapshot: { ...snapshot, revision: "r2" }
});
await holds("inventory_snapshot_scope_mismatch", {
  ...base, snapshot: { ...snapshot, attemptId: "different" }
});
await holds("inventory_target_set_drift", {
  ...base, snapshot: { ...snapshot, hosts: [scope.expectedHosts[0]] }
});
await holds("inventory_target_set_drift", {
  ...base, snapshot: { ...snapshot, hosts: [
    scope.expectedHosts[0], scope.expectedHosts[0]
  ] }
});
await holds("inventory_snapshot_stale_or_expired", {
  ...base, snapshot: { ...snapshot, expiresAtEpochMs: now }
});
await holds("production_release_not_authorized", {
  ...base, intent: "production_release"
});
console.log("PASS Day 92 morning: stable candidate digest, exact binding, drift HOLD.");
console.log("LIMIT: no authenticated source, durable freeze CAS, trusted signature or GO.");
