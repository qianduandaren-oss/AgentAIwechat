import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DAY93_AUDIT_ANCHOR_DOMAIN,
  type Day93AuditAnchorCandidate
} from "../runtime/recovery-writer-inventory-audit-anchor.js";
import {
  SQLiteDay93AuditCheckpointStore
} from "../runtime/recovery-writer-inventory-audit-checkpoint-store.js";
import {
  reviewDay93AuditReleaseBoundary
} from "../runtime/recovery-writer-inventory-audit-release-boundary.js";
import { SQLiteDay92InventoryFreezeStore } from
  "../runtime/recovery-writer-inventory-freeze-store.js";
import { planDay92InventoryFreezeCandidate } from
  "../runtime/recovery-writer-inventory-freeze-candidate.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day93-evening-double-rollback-"));
const inventoryPath = join(dir, "inventory.sqlite");
const auditPath = join(dir, "audit.sqlite");
const now = Date.UTC(2026, 10, 22, 10, 0, 0);
const scope = {
  deploymentId: "staging:day93", releaseId: "release-93",
  attemptId: "attempt-93-evening",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const expectedAnchor = { snapshotId: "fixture-93-evening", revision: "r1" };
const snapshot: Day91InventorySnapshot = {
  ...scope, ...expectedAnchor, hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 2500, expiresAtEpochMs: now + 60_000
};
const inventory = new SQLiteDay92InventoryFreezeStore(inventoryPath);
const audit = new SQLiteDay93AuditCheckpointStore(auditPath);
let candidateSnapshot: Day91InventorySnapshot = snapshot;

try {
  const planned = await planDay92InventoryFreezeCandidate({
    intent: "isolated_review", scope, expectedAnchor, snapshot, nowEpochMs: now
  });
  assert.ok(planned.candidate);
  const digest = planned.candidate.manifestSha256;
  assert.equal(inventory.freezeOnce(snapshot, digest).status, "frozen");
  const anchor1: Day93AuditAnchorCandidate = {
    domain: DAY93_AUDIT_ANCHOR_DOMAIN,
    deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, snapshotId: expectedAnchor.snapshotId,
    revision: expectedAnchor.revision, manifestSha256: digest,
    freezeVersion: 1, state: "frozen", checkpointSequence: 1,
    recordedAtEpochMs: now - 1500, expiresAtEpochMs: now + 60_000
  };
  const head1 = audit.appendOnce(anchor1, {checkpointSequence: 0, eventSha256: null});
  assert.equal(head1.status, "appended");
  assert.ok("head" in head1);
  const inventoryAdapter = {async readSnapshot() { return candidateSnapshot; }};
  const review = (version = 1, reader: typeof audit | null = audit,
    intent: "isolated_review" | "production_release" = "isolated_review") =>
    reviewDay93AuditReleaseBoundary({
      intent, scope, expectedAnchor, nowEpochMs: now,
      store: inventory, expectedFreezeVersion: version,
      expectedFreezeSha256: digest, inventoryAdapter,
      hostReceipts: [], consumerAck: null, auditReader: reader
    });

  const first = await review();
  assert.equal(first.auditReason, "checkpoint_candidate_consistent_but_source_unverified");
  assert.equal(first.freezeReason, "fixture_freeze_consistent_but_source_unverified");
  assert.equal(first.requiredHostCheckSlots, 28);
  assert.equal(first.requiredSourceTasks, 30);
  assert.equal(first.authenticatedExternalAnchorCount, 0);
  assert.equal(first.authenticatedEvidenceCount, 0);
  assert.equal(first.publishAuthorized, false);
  assert.ok(first.blockers.includes("same_trust_domain_double_rollback_not_excluded"));
  assert.ok(first.evidenceChainReasons.some(r => r.includes("consumer_ack_missing")));
  assert.equal((await review(1, null)).auditReason, "audit_anchor_reader_unavailable");

  candidateSnapshot = {...snapshot, revision: "r2"};
  assert.ok((await review()).evidenceChainReasons.some(
    reason => reason.includes("inventory_snapshot_anchor_mismatch")));
  candidateSnapshot = snapshot;

  const anchor2: Day93AuditAnchorCandidate = {
    ...anchor1, state: "invalidated", freezeVersion: 2,
    checkpointSequence: 2, recordedAtEpochMs: now - 800
  };
  const head2 = audit.appendOnce(anchor2, {
    checkpointSequence: 1, eventSha256: head1.head.eventSha256
  });
  assert.equal(head2.status, "appended");
  assert.equal(inventory.invalidate(scope, {version: 1, manifestSha256: digest}),
    "invalidated");
  assert.equal((await review(2)).auditReason, "attempt_invalidated_no_reuse");

  // Inventory-only rollback is visible against a retained v2 checkpoint.
  const localSql = new DatabaseSync(inventoryPath);
  try {
    localSql.prepare(
      "UPDATE recovery_writer_inventory_freezes SET state='frozen',version=1 " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).run(scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { localSql.close(); }
  assert.equal((await review()).auditReason,
    "sqlite_rollback_suspected_anchor_ahead");

  // Same OS owner rolls back BOTH candidate files. All local hashes still
  // verify, and a caller-controlled old pin also matches. This is a failure
  // counterexample: a fresh externally authenticated watermark is REQUIRED.
  const auditSql = new DatabaseSync(auditPath);
  try {
    auditSql.exec("DROP TRIGGER recovery_writer_audit_no_delete");
    auditSql.prepare(
      "DELETE FROM recovery_writer_audit_events WHERE deployment_id=? " +
      "AND release_id=? AND attempt_id=? AND sequence=2"
    ).run(scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { auditSql.close(); }
  assert.equal(audit.readHead(scope)?.candidate.checkpointSequence, 1);
  const hidden = await review(1);
  assert.equal(hidden.auditReason, "checkpoint_candidate_consistent_but_source_unverified");
  assert.equal(hidden.freezeReason, "fixture_freeze_consistent_but_source_unverified");
  assert.equal(hidden.publishAuthorized, false);
  assert.ok(hidden.blockers.includes("same_trust_domain_double_rollback_not_excluded"));

  // Corrupt the chain as the DB owner; the reviewer must fail closed.
  const tamper = new DatabaseSync(auditPath);
  try {
    tamper.exec("DROP TRIGGER recovery_writer_audit_no_update");
    tamper.prepare(
      "UPDATE recovery_writer_audit_events SET event_sha256=? " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=? AND sequence=1"
    ).run("a".repeat(64), scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { tamper.close(); }
  const corrupt = await review();
  assert.equal(corrupt.auditReason, "audit_anchor_read_failed");
  assert.equal(corrupt.publishAuthorized, false);
  const prod = await review(1, audit, "production_release");
  assert.equal(prod.auditReason, "production_release_not_authorized");
  assert.equal(prod.publishAuthorized, false);

  console.log("PASS Day 93 evening: composite HOLD, inventory drift, single rollback detection.");
  console.log("PASS same-domain double rollback can look consistent but NEVER authorizes GO.");
  console.log("PASS tampered audit chain, missing reader, production intent all fail closed.");
  console.log("LIMIT no independently authenticated high-watermark, OS census, or real ACK.");
} finally {
  audit.close();
  inventory.close();
  rmSync(dir, {recursive: true, force: true});
}
