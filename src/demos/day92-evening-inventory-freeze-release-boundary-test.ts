import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { planDay92InventoryFreezeCandidate } from
  "../runtime/recovery-writer-inventory-freeze-candidate.js";
import { SQLiteDay92InventoryFreezeStore } from
  "../runtime/recovery-writer-inventory-freeze-store.js";
import { reviewDay92FrozenCutoverBoundary } from
  "../runtime/recovery-writer-inventory-freeze-release-boundary.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day92-evening-boundary-"));
const dbPath = join(dir, "inventory.sqlite");
const now = Date.UTC(2026, 10, 21, 10, 0);
const scope = {
  deploymentId: "staging:day92", releaseId: "release-92",
  attemptId: "attempt-92-evening",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const expectedAnchor = { snapshotId: "fixture-92-evening", revision: "r1" };
const snapshot: Day91InventorySnapshot = {
  ...scope, ...expectedAnchor, hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60_000
};

let store = new SQLiteDay92InventoryFreezeStore(dbPath);
let candidateSnapshot: Day91InventorySnapshot = snapshot;
const inventoryAdapter = {
  async readSnapshot() { return candidateSnapshot; }
};
try {
  const planned = await planDay92InventoryFreezeCandidate({
    intent: "isolated_review", scope, expectedAnchor, snapshot, nowEpochMs: now
  });
  assert.ok(planned.candidate);
  const digest = planned.candidate!.manifestSha256;
  const first = store.freezeOnce(snapshot, digest);
  assert.equal(first.status, "frozen");
  if (!("record" in first)) throw Error("missing_frozen_record");
  const original = first.record;
  const review = (expectedFreezeVersion = 1,
    expectedFreezeSha256 = digest,
    intent: "isolated_review" | "production_release" = "isolated_review") =>
    reviewDay92FrozenCutoverBoundary({
      intent, scope, expectedAnchor, nowEpochMs: now,
      store, expectedFreezeVersion, expectedFreezeSha256,
      inventoryAdapter, hostReceipts: [], consumerAck: null
    });

  // A matching, persistent candidate + the Day 91 evidence chain is STILL HOLD.
  const matched = await review();
  assert.equal(matched.freezeReason, "fixture_freeze_consistent_but_source_unverified");
  assert.equal(matched.requiredHostCheckSlots, 28);
  assert.equal(matched.requiredSourceTasks, 30);
  assert.equal(matched.authenticatedEvidenceCount, 0);
  assert.equal(matched.publishAuthorized, false);
  assert.ok(matched.evidenceChainReasons.some(r => r.includes("consumer_ack_missing")));
  assert.equal((await review(1, digest, "production_release")).freezeReason,
    "production_release_not_authorized");
  assert.equal((await review(2)).freezeReason, "freeze_version_mismatch");
  assert.equal((await review(1, "f".repeat(64))).freezeReason, "freeze_digest_mismatch");

  // Snapshot drift is caught by the existing Day 91 provenance chain.
  candidateSnapshot = { ...snapshot, revision: "r2" };
  const drift = await review();
  assert.ok(drift.evidenceChainReasons.some(r =>
    r.includes("inventory_snapshot_anchor_mismatch")));
  candidateSnapshot = snapshot;

  // A transaction interrupted BEFORE COMMIT leaves the last freeze unchanged.
  const faultDb = new DatabaseSync(dbPath);
  try {
    faultDb.exec("BEGIN IMMEDIATE");
    faultDb.prepare(
      "UPDATE recovery_writer_inventory_freezes SET version=99 " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run(scope.deploymentId, scope.releaseId, scope.attemptId);
    faultDb.exec("ROLLBACK");
  } finally { faultDb.close(); }
  assert.equal(store.load(scope)?.version, 1);

  // Restart must recover identical immutable bytes rather than a new record.
  store.close();
  store = new SQLiteDay92InventoryFreezeStore(dbPath);
  assert.equal(store.load(scope)?.manifestJson, original.manifestJson);
  assert.equal((await review()).publishAuthorized, false);

  // Direct SQL can tamper with the DB outside the CAS API. Digest check catches
  // a partial edit; a coherent full edit would need a protected external pin.
  const bypass = new DatabaseSync(dbPath);
  try {
    bypass.prepare(
      "UPDATE recovery_writer_inventory_freezes SET manifest_json=? " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run("[\"attacker\"]", scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { bypass.close(); }
  assert.equal((await review()).freezeReason, "freeze_store_unavailable_or_tampered");

  const repair = new DatabaseSync(dbPath);
  try {
    repair.prepare(
      "UPDATE recovery_writer_inventory_freezes SET manifest_json=? " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run(original.manifestJson, scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { repair.close(); }

  // Valid CAS invalidation persists; old attempt can no longer be frozen.
  assert.equal(store.invalidate(scope, {version: 1, manifestSha256: digest}), "invalidated");
  assert.equal((await review(2)).freezeReason, "freeze_attempt_invalidated");
  store.close();
  store = new SQLiteDay92InventoryFreezeStore(dbPath);
  assert.equal(store.load(scope)?.state, "invalidated");

  // Deliberately model a dangerous file/SQL rollback, not a safe recovery.
  // A separately remembered version catches it; an attacker who also controls
  // the version pin could still hide it. This is a reproduced counterexample.
  const rollback = new DatabaseSync(dbPath);
  try {
    rollback.prepare(
      "UPDATE recovery_writer_inventory_freezes " +
      "SET state='frozen',version=1 " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run(scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { rollback.close(); }
  assert.equal((await review(2)).freezeReason, "freeze_version_mismatch");
  assert.equal((await review(1)).freezeReason,
    "fixture_freeze_consistent_but_source_unverified");
  assert.equal((await review(1)).publishAuthorized, false);

  console.log("PASS Day 92 evening: durable freeze vs evidence chain,");
  console.log("crash rollback, restart, tamper, stale pin and unsafe SQL rollback.");
  console.log("WARN: rollback + attacker-controlled pin can hide a revived attempt.");
  console.log("LIMIT: no trusted source, external watermark, OS isolation or ACK. NO_GO.");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
