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
  SQLiteDay93AuditCheckpointStore
} from "../runtime/recovery-writer-inventory-audit-checkpoint-store.js";
import { SQLiteDay92InventoryFreezeStore } from
  "../runtime/recovery-writer-inventory-freeze-store.js";
import { planDay92InventoryFreezeCandidate } from
  "../runtime/recovery-writer-inventory-freeze-candidate.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day93-noon-anchor-cas-"));
const inventoryPath = join(dir, "inventory.sqlite");
const anchorPath = join(dir, "audit-separate-fixture.sqlite");
const now = Date.UTC(2026, 10, 22, 4, 0, 0);
const scope = {
  deploymentId: "staging:day93", releaseId: "release-93",
  attemptId: "attempt-93-noon",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const snapshot: Day91InventorySnapshot = {
  deploymentId: scope.deploymentId, releaseId: scope.releaseId,
  attemptId: scope.attemptId, snapshotId: "fixture-snapshot-93",
  revision: "r1", capturedAtEpochMs: now - 2500,
  expiresAtEpochMs: now + 60_000, hosts: scope.expectedHosts
};
const inventory = new SQLiteDay92InventoryFreezeStore(inventoryPath);
let writer: SQLiteDay93AuditCheckpointStore | null = null;
let competitor: SQLiteDay93AuditCheckpointStore | null = null;
let reopened: SQLiteDay93AuditCheckpointStore | null = null;

try {
  const planned = await planDay92InventoryFreezeCandidate({
    intent: "isolated_review", scope, snapshot, nowEpochMs: now,
    expectedAnchor: { snapshotId: snapshot.snapshotId, revision: snapshot.revision }
  });
  assert.ok(planned.candidate);
  const digest = planned.candidate.manifestSha256;
  assert.equal(inventory.freezeOnce(snapshot, digest).status, "frozen");

  const frozenAnchor: Day93AuditAnchorCandidate = {
    domain: DAY93_AUDIT_ANCHOR_DOMAIN,
    deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, snapshotId: snapshot.snapshotId,
    revision: snapshot.revision, manifestSha256: digest,
    freezeVersion: 1, state: "frozen", checkpointSequence: 1,
    recordedAtEpochMs: now - 1500, expiresAtEpochMs: now + 60_000
  };
  writer = new SQLiteDay93AuditCheckpointStore(anchorPath);
  competitor = new SQLiteDay93AuditCheckpointStore(anchorPath);
  const genesis = { checkpointSequence: 0, eventSha256: null };
  const inserted = writer.appendOnce(frozenAnchor, genesis);
  assert.equal(inserted.status, "appended");
  assert.ok("head" in inserted);
  assert.equal(competitor.appendOnce(frozenAnchor, genesis).status, "exact_replay");
  assert.equal(competitor.appendOnce({
    ...frozenAnchor, recordedAtEpochMs: now - 1400
  }, genesis).status, "cas_conflict");
  assert.equal(writer.readHead(scope)?.candidate.checkpointSequence, 1);

  // Lock contention: another connection cannot bypass BEGIN IMMEDIATE.
  const invalidatedAnchor: Day93AuditAnchorCandidate = {
    ...frozenAnchor, state: "invalidated", freezeVersion: 2,
    checkpointSequence: 2, recordedAtEpochMs: now - 800
  };
  const expectedV1 = { checkpointSequence: 1, eventSha256: inserted.head.eventSha256 };
  const blocker = new DatabaseSync(anchorPath);
  try {
    blocker.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => competitor!.appendOnce(invalidatedAnchor, expectedV1),
      /locked|busy|SQLITE_BUSY/i
    );
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
  }

  assert.equal(competitor.appendOnce(invalidatedAnchor, expectedV1).status, "appended");
  assert.equal(writer.appendOnce({
    ...invalidatedAnchor, recordedAtEpochMs: now - 700
  }, expectedV1).status, "cas_conflict");
  const head2 = writer.readHead(scope);
  assert.ok(head2);
  assert.equal(head2.candidate.checkpointSequence, 2);
  assert.equal(writer.appendOnce({
    ...invalidatedAnchor, checkpointSequence: 3, freezeVersion: 3,
    recordedAtEpochMs: now - 100
  }, { checkpointSequence: 2, eventSha256: head2.eventSha256 }).status,
  "transition_rejected");
  assert.equal(inventory.invalidate(scope, { version: 1, manifestSha256: digest }),
    "invalidated");

  writer.close(); writer = null;
  competitor.close(); competitor = null;
  reopened = new SQLiteDay93AuditCheckpointStore(anchorPath);
  assert.equal(reopened.readHead(scope)?.eventSha256, head2.eventSha256);
  const matching = await reviewDay93AuditAnchorCandidate({
    intent: "isolated_review", scope, store: inventory,
    nowEpochMs: now, reader: reopened
  });
  assert.equal(matching.reason, "attempt_invalidated_no_reuse");
  assert.equal(matching.authenticatedExternalAnchorCount, 0);
  assert.equal(matching.publishAuthorized, false);

  // An attacker in the inventory DB's OS trust domain restores old version=1.
  const unsafe = new DatabaseSync(inventoryPath);
  try {
    unsafe.prepare("UPDATE recovery_writer_inventory_freezes " +
      "SET version=1,state='frozen' WHERE deployment_id=? " +
      "AND release_id=? AND attempt_id=?").run(
        scope.deploymentId, scope.releaseId, scope.attemptId);
  } finally { unsafe.close(); }
  const rollbackDetected = await reviewDay93AuditAnchorCandidate({
    intent: "isolated_review", scope, store: inventory,
    nowEpochMs: now, reader: reopened
  });
  assert.equal(rollbackDetected.reason, "sqlite_rollback_suspected_anchor_ahead");
  assert.equal(rollbackDetected.publishAuthorized, false);

  // SQL owner can DROP protective triggers: this is not an immutable remote log.
  const attacker = new DatabaseSync(anchorPath);
  try {
    assert.throws(() => attacker.prepare(
      "UPDATE recovery_writer_audit_events SET event_sha256=?"
    ).run("a".repeat(64)), /append_only_update_forbidden/);
    attacker.exec("DROP TRIGGER recovery_writer_audit_no_update");
    attacker.prepare("UPDATE recovery_writer_audit_events SET event_sha256=? " +
      "WHERE sequence=2").run("a".repeat(64));
  } finally { attacker.close(); }
  assert.throws(() => reopened!.readHead(scope), /audit_checkpoint_chain_corrupt/);
  const damaged = await reviewDay93AuditAnchorCandidate({
    intent: "isolated_review", scope, store: inventory, nowEpochMs: now,
    reader: reopened
  });
  assert.equal(damaged.reason, "audit_anchor_read_failed");
  assert.equal(damaged.publishAuthorized, false);

  console.log("PASS Day 93 noon: two-connection CAS, busy lock, restart, chain-integrity rejection.");
  console.log("PASS isolated rollback detected when only local inventory is restored.");
  console.log("LIMIT separate SQLite file and SQL triggers are NOT independent trust/authentication.");
  console.log("LIMIT combined rollback, OS write bypass, real Collector and Consumer ACK remain NO_GO.");
} finally {
  if (reopened) reopened.close();
  if (competitor) competitor.close();
  if (writer) writer.close();
  inventory.close();
  rmSync(dir, { recursive: true, force: true });
}
