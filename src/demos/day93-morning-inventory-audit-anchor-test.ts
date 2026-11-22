import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DAY93_AUDIT_ANCHOR_DOMAIN,
  reviewDay93AuditAnchorCandidate,
  type Day93AuditAnchorCandidate
} from "../runtime/recovery-writer-inventory-audit-anchor.js";
import {
  planDay92InventoryFreezeCandidate
} from "../runtime/recovery-writer-inventory-freeze-candidate.js";
import {
  SQLiteDay92InventoryFreezeStore
} from "../runtime/recovery-writer-inventory-freeze-store.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day93-morning-audit-anchor-"));
const dbPath = join(dir, "inventory.sqlite");
const now = Date.UTC(2026, 10, 22, 0, 0, 0);
const scope = {
  deploymentId: "staging:day93", releaseId: "release-93",
  attemptId: "attempt-93-01",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const snapshot: Day91InventorySnapshot = {
  deploymentId: scope.deploymentId, releaseId: scope.releaseId,
  attemptId: scope.attemptId, snapshotId: "fixture-93", revision: "r1",
  capturedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60_000,
  hosts: scope.expectedHosts
};

const store = new SQLiteDay92InventoryFreezeStore(dbPath);
try {
  const plan = await planDay92InventoryFreezeCandidate({
    intent: "isolated_review", scope, snapshot, nowEpochMs: now,
    expectedAnchor: { snapshotId: snapshot.snapshotId, revision: snapshot.revision }
  });
  assert.ok(plan.candidate);
  const digest = plan.candidate!.manifestSha256;
  const frozen = store.freezeOnce(snapshot, digest);
  assert.equal(frozen.status, "frozen");

  const checkpoint: Day93AuditAnchorCandidate = {
    domain: DAY93_AUDIT_ANCHOR_DOMAIN,
    deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, snapshotId: snapshot.snapshotId,
    revision: snapshot.revision, manifestSha256: digest,
    freezeVersion: 1, state: "frozen", checkpointSequence: 1,
    recordedAtEpochMs: now - 500, expiresAtEpochMs: now + 60_000
  };

  const review = (
    candidate: Day93AuditAnchorCandidate | null = checkpoint,
    overrides: Partial<Parameters<typeof reviewDay93AuditAnchorCandidate>[0]> = {}
  ) => reviewDay93AuditAnchorCandidate({
    intent: "isolated_review", scope, store, nowEpochMs: now,
    reader: { async readAnchor() { return candidate; } },
    ...overrides
  });
  const expectHold = async (
    reason: string,
    candidate: Day93AuditAnchorCandidate | null = checkpoint,
    overrides: Partial<Parameters<typeof reviewDay93AuditAnchorCandidate>[0]> = {}
  ) => {
    const result = await review(candidate, overrides);
    assert.equal(result.action, "hold");
    assert.equal(result.reason, reason);
    assert.equal(result.authenticatedExternalAnchorCount, 0);
    assert.equal(result.publishAuthorized, false);
    return result;
  };

  const exact = await expectHold("checkpoint_candidate_consistent_but_source_unverified");
  assert.equal(exact.localFreezeVersion, 1);
  assert.equal(exact.candidateCheckpointSequence, 1);
  await expectHold("production_release_not_authorized", checkpoint,
    { intent: "production_release" });
  await expectHold("audit_anchor_reader_unavailable", checkpoint, { reader: null });
  await expectHold("audit_anchor_missing", null);
  await expectHold("audit_anchor_attempt_binding_mismatch",
    { ...checkpoint, attemptId: "other" });
  await expectHold("audit_anchor_snapshot_binding_mismatch",
    { ...checkpoint, revision: "r2" });
  await expectHold("audit_anchor_manifest_digest_mismatch",
    { ...checkpoint, manifestSha256: "a".repeat(64) });
  await expectHold("audit_anchor_stale_or_expired",
    { ...checkpoint, recordedAtEpochMs: now - 600_000 });
  await expectHold("audit_anchor_time_invalid",
    { ...checkpoint, recordedAtEpochMs: now + 1000 });
  await expectHold("audit_anchor_format_invalid",
    { ...checkpoint, checkpointSequence: 0 });
  await expectHold("audit_anchor_format_invalid",
    { ...checkpoint, domain: "wrong-domain" as typeof DAY93_AUDIT_ANCHOR_DOMAIN });
  await expectHold("audit_anchor_read_failed", checkpoint, {
    reader: { async readAnchor(): Promise<Day93AuditAnchorCandidate | null> {
      throw Error("isolated anchor endpoint offline");
    } }
  });

  // A fake "authenticated" claim on the object must NOT influence trust.
  const forgedClaim = { ...checkpoint, claimedAuthenticated: true };
  await expectHold("checkpoint_candidate_consistent_but_source_unverified", forgedClaim);

  // Day 92 invalidation advances local version from 1 to 2.
  assert.equal(store.invalidate(scope, {
    version: 1, manifestSha256: digest
  }), "invalidated");
  const anchorV2: Day93AuditAnchorCandidate = {
    ...checkpoint, freezeVersion: 2, state: "invalidated",
    checkpointSequence: 2, recordedAtEpochMs: now - 100
  };
  await expectHold("attempt_invalidated_no_reuse", anchorV2);
  await expectHold("audit_anchor_lagging_or_split_brain", checkpoint);

  // Deliberate isolated unsafe SQL rollback; external v2 candidate catches it.
  const attacker = new DatabaseSync(dbPath);
  try {
    attacker.prepare(
      "UPDATE recovery_writer_inventory_freezes SET version=1,state='frozen' " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run(scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { attacker.close(); }
  await expectHold("sqlite_rollback_suspected_anchor_ahead", anchorV2);

  // Both local DB and untrusted reader are now rolled back to v1:
  // this reproduces an undetectable coherent rollback WITHIN one trust domain.
  await expectHold("checkpoint_candidate_consistent_but_source_unverified", checkpoint);
  console.log("PASS Day 93 morning: separate-anchor candidate detects SQLite version rollback.");
  console.log("LIMIT: reader is injected and not authenticated; paired rollback remains hidden.");
  console.log("LIMIT: no real external immutable log, host proof or Consumer ACK. NO_GO.");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
