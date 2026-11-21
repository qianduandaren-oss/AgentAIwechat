import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SQLiteDay92InventoryFreezeStore,
  Day92IsolatedInventoryFreezeService
} from "../runtime/recovery-writer-inventory-freeze-store.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day92-noon-freeze-"));
const dbPath = join(dir, "inventory.sqlite");
const now = Date.UTC(2026, 10, 21, 4, 0);
const scope = {
  deploymentId: "staging:day92", releaseId: "release-92",
  attemptId: "attempt-92-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const anchor = { snapshotId: "fixture-92", revision: "r1" };
const initial: Day91InventorySnapshot = {
  ...scope, ...anchor, hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60000
};
let candidate: Day91InventorySnapshot | null = initial;
let error = false;
const source = {
  async readSnapshot() {
    if (error) throw Error("fixture_unavailable");
    return candidate;
  }
};
let a = new SQLiteDay92InventoryFreezeStore(dbPath);
const b = new SQLiteDay92InventoryFreezeStore(dbPath);
const service = (store: SQLiteDay92InventoryFreezeStore) =>
  new Day92IsolatedInventoryFreezeService({
    store, source, scope, expectedAnchor: anchor
  });
const run = (store: SQLiteDay92InventoryFreezeStore, intent:
  "isolated_review" | "production_release" = "isolated_review") =>
  service(store).reviewAndFreeze({ intent, nowEpochMs: now });

try {
  assert.equal((await run(a, "production_release")).reason,
    "production_release_not_authorized");
  assert.equal(a.load(scope), null);

  // Two open connections race for the same immutable attempt. Only one insert.
  const [first, replay] = await Promise.all([run(a), run(b)]);
  assert.equal(first.reason, "durable_fixture_frozen_source_unverified");
  assert.equal(replay.reason, "durable_fixture_exact_replay_source_unverified");
  assert.equal(first.authenticatedInventoryCount, 0);
  assert.equal(first.publishAuthorized, false);
  const record = a.load(scope)!;
  assert.equal(record.version, 1);
  assert.equal(record.state, "frozen");
  assert.equal(record.manifestSha256.length, 64);

  // The exact on-disk manifest survives a crash/restart of the reader.
  a.close();
  a = new SQLiteDay92InventoryFreezeStore(dbPath);
  assert.equal(a.load(scope)?.manifestSha256, record.manifestSha256);
  assert.equal((await run(a)).reason,
    "durable_fixture_exact_replay_source_unverified");

  // SAME revision, SAME attempt, different bytes: never silently replace.
  candidate = { ...initial, capturedAtEpochMs: now - 2000 };
  const changed = await run(b);
  assert.equal(changed.reason, "same_attempt_manifest_conflict");
  assert.equal(a.load(scope)?.manifestSha256, record.manifestSha256);

  // Revisions and targets cannot drift away from the pinned fixture anchor.
  candidate = { ...initial, revision: "r2" };
  assert.equal((await run(b)).reason, "inventory_snapshot_anchor_mismatch");
  candidate = { ...initial, hosts: [initial.hosts[0]] };
  assert.equal((await run(b)).reason, "inventory_target_set_drift");
  candidate = { ...initial, expiresAtEpochMs: now - 1 };
  assert.equal((await run(b)).reason, "inventory_snapshot_stale_or_expired");

  candidate = null;
  assert.equal((await run(b)).reason, "inventory_snapshot_unavailable");
  error = true;
  assert.equal((await run(b)).reason, "inventory_source_unavailable");
  error = false;

  // Explicit invalidation is a version+digest CAS; no in-place resurrection.
  assert.equal(b.invalidate(scope, {
    version: 999, manifestSha256: record.manifestSha256
  }), "conflict");
  assert.equal(b.invalidate(scope, {
    version: record.version, manifestSha256: "f".repeat(64)
  }), "conflict");
  assert.equal(b.invalidate(scope, {
    version: record.version, manifestSha256: record.manifestSha256
  }), "invalidated");
  assert.equal(a.load(scope)?.version, 2);
  candidate = initial;
  assert.equal((await run(a)).reason, "attempt_invalidated_new_attempt_required");
  assert.equal(b.invalidate(scope, {
    version: record.version, manifestSha256: record.manifestSha256
  }), "conflict");

  // New attempt is the only way to freeze new scope after invalidation.
  const nextScope = { ...scope, attemptId: "attempt-92-02" };
  candidate = { ...initial, attemptId: nextScope.attemptId };
  const next = new Day92IsolatedInventoryFreezeService({
    store: b, source, scope: nextScope, expectedAnchor: anchor
  });
  assert.equal((await next.reviewAndFreeze({
    intent: "isolated_review", nowEpochMs: now
  })).reason, "durable_fixture_frozen_source_unverified");
  assert.equal(b.load(nextScope)?.version, 1);
  assert.equal(b.load(scope)?.state, "invalidated");

  console.log("PASS Day 92 noon: BEGIN IMMEDIATE immutable freeze, exact replay,");
  console.log("same-attempt conflict, restart, version CAS invalidation, new attempt.");
  console.log("LIMIT: fixture source, no real auth/OS isolation/ACK; production NO_GO.");
} finally {
  a.close();
  b.close();
  rmSync(dir, { recursive: true, force: true });
}
