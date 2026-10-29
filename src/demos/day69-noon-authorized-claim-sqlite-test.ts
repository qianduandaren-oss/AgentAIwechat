import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { InMemoryRecoveryControlStore } from "../runtime/recovery-operations.js";
import { DurableRecoveryOperationOrchestrator, type DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import { ClaimRequiredRecoveryEntry } from "../runtime/recovery-claim-required-entry.js";
import { RecoveryIngressGate } from "../runtime/recovery-ingress-gate.js";
import { handleRecoveryIngressResponse } from "../runtime/recovery-ingress-response.js";
import {
  RecoveryAuthorizationEvidenceConflictError,
  type RecoveryAuthorizationEvidence
} from "../runtime/recovery-authorization-evidence.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Day 69 noon authorization + Claim: " + message);
}
const now = () => "2026-10-29T04:00:00.000Z";
let n = 0;
let passed = 0;

async function fixture() {
  await mkdir("tmp", { recursive: true });
  const id = ++n;
  const file = `tmp/day69-noon-${Date.now()}-${id}.db`;
  const f = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  // A physically separate SQLite connection represents a trusted local ACL writer.
  const admin = new DatabaseSync(file);
  admin.exec("PRAGMA busy_timeout = 5000;");
  const runId = `day69-run-${id}`;
  const actorId = "operator-a";
  const tenantId = "tenant-a";
  const command: DurableRecoveryOperationCommand = {
    commandId: `day69-command-${id}`, runId,
    operation: "quarantine", requestedBy: actorId,
    reason: "review ambiguous tool effect",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const evidence: RecoveryAuthorizationEvidence = {
    actorId, tenantId, runId, operation: "quarantine", allowed: true,
    revisions: {
      runTenantRevision: 4,
      runAclRevision: 11,
      actorGrantRevision: 9
    }
  };
  admin.prepare(`
    INSERT INTO recovery_authority_runs
      (run_id, tenant_id, tenant_revision, acl_revision)
    VALUES (?, ?, 4, 11)
  `).run(runId, tenantId);
  admin.prepare(`
    INSERT INTO recovery_authority_actor_grants
      (actor_id, tenant_id, operation, grant_revision, allowed)
    VALUES (?, ?, 'quarantine', 9, 1)
  `).run(actorId, tenantId);
  admin.prepare(`
    INSERT INTO recovery_authority_run_permissions
      (run_id, actor_id, operation, allowed)
    VALUES (?, ?, 'quarantine', 1)
  `).run(runId, actorId);
  return {
    f, admin, command, evidence, runId, actorId, tenantId, file,
    close() { admin.close(); f.close(); }
  };
}

async function mustRejectWithoutAdmission(
  mutate: (f: Awaited<ReturnType<typeof fixture>>) => void,
  label: string
) {
  const x = await fixture();
  try {
    mutate(x);
    let conflict = false;
    try { await x.f.claimAuthorized(x.command, "atomic_control_only", x.evidence); }
    catch (error) { conflict = error instanceof RecoveryAuthorizationEvidenceConflictError; }
    check(conflict, label + " must fail closed");
    check(!x.f.loadCommand(x.command.commandId) &&
      !x.f.loadControl(x.command.runId) &&
      x.f.countOutbox() === 0, label + " must have ZERO Admission/Control/Outbox");
    passed++;
  } finally { x.close(); }
}

// A clean authoritative snapshot is accepted and duplicates cannot re-run.
{
  const x = await fixture();
  try {
    const first = await x.f.claimAuthorized(x.command, "atomic_control_only", x.evidence);
    check(first.action === "claimed_executing" &&
      first.record.version === 2 &&
      first.record.executionOwner === "atomic_control_only", "fresh evidence claims");
    const repeat = await x.f.claimAuthorized(x.command, "atomic_control_only", x.evidence);
    check(repeat.action === "suspend_in_flight", "same command cannot execute twice");
    check(x.f.loadCommand(x.command.commandId)?.version === 2, "one executing v2");
    passed++;
  } finally { x.close(); }
}
// The grant change was COMMITTED on a separate connection before Claim.
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_actor_grants
    SET grant_revision = 10, allowed = 0 WHERE actor_id = ?`).run(x.actorId);
}, "grant revoked and version changed");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_runs
    SET acl_revision = 12 WHERE run_id = ?`).run(x.runId);
}, "Run ACL revision drift");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_runs
    SET tenant_revision = 5 WHERE run_id = ?`).run(x.runId);
}, "Run tenant revision drift");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_runs
    SET tenant_id = 'tenant-b' WHERE run_id = ?`).run(x.runId);
}, "Run migrated to another tenant");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_actor_grants
    SET allowed = 0 WHERE actor_id = ?`).run(x.actorId);
}, "grant revoked even with stale unchanged revision");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`UPDATE recovery_authority_run_permissions
    SET allowed = 0 WHERE run_id = ?`).run(x.runId);
}, "Run-specific permission revoked");
await mustRejectWithoutAdmission(x => {
  x.admin.prepare(`DELETE FROM recovery_authority_actor_grants
    WHERE actor_id = ?`).run(x.actorId);
}, "authority grant missing");
await mustRejectWithoutAdmission(x => {
  x.evidence = { ...x.evidence, actorId: "operator-b" };
}, "evidence bound to another actor");

// In-flight replay also checks the CURRENT authority before releasing facts.
{
  const x = await fixture();
  try {
    await x.f.claimAuthorized(x.command, "atomic_control_only", x.evidence);
    x.admin.prepare(`UPDATE recovery_authority_actor_grants
      SET grant_revision = 10, allowed = 0 WHERE actor_id = ?`).run(x.actorId);
    let denied = false;
    try { await x.f.claimAuthorized(x.command, "atomic_control_only", x.evidence); }
    catch (error) { denied = error instanceof RecoveryAuthorizationEvidenceConflictError; }
    check(denied && x.f.loadCommand(x.command.commandId)?.version === 2,
      "in-flight existing row cannot bypass revocation");
    passed++;
  } finally { x.close(); }
}

// Existing Day 67/68 execution chain, with SAME-DB authorized Claim bound
// per request. The simulated permission policy revokes AFTER it returns allow
// but BEFORE Claim. Only the new atomic revision check prevents Admission.
{
  const x = await fixture();
  const checkpointsDb = new SQLiteTransactionalCheckpointDatabase(x.file);
  try {
    const checkpoints = new TransactionalCheckpointStore(checkpointsDb);
    const checkpoint = await checkpoints.save({
      ...createInitialCheckpoint(x.runId), boundary: "reconciling_tool"
    }, 0);
    check(checkpoint.version === 1, "seed checkpoint v1");
    const legacy = new DurableRecoveryOperationOrchestrator(
      x.f.asLegacyCommandStore(),
      { async execute() { throw new Error("Legacy bypass must not execute"); } },
      checkpoints, new InMemoryRecoveryControlStore(), { now }
    );
    const atomic = new AtomicRecoveryControlOnlyAdapter(
      x.f, { async authorize() {
        throw new Error("atomic business authorizer must not run after revocation");
      } }, now
    );
    // This request-bound adapter never falls back to raw claim().
    const authorizedClaimer = {
      claim: (command: DurableRecoveryOperationCommand, owner: "legacy" | "atomic_control_only") =>
        x.f.claimAuthorized(command, owner, x.evidence)
    };
    const entry = new ClaimRequiredRecoveryEntry(
      { legacy, atomic }, true, authorizedClaimer
    );
    const gate = new RecoveryIngressGate(
      entry,
      { async findTenantId() { return x.tenantId; } },
      { async canOperate() {
        // Deliberate TOCTOU: ACL updates after preflight.
        x.admin.prepare(`UPDATE recovery_authority_actor_grants
          SET grant_revision = 10, allowed = 0 WHERE actor_id = ?`).run(x.actorId);
        return true;
      } }
    );
    const response = await handleRecoveryIngressResponse(gate, {
      commandId: x.command.commandId, runId: x.command.runId,
      operation: x.command.operation, reason: x.command.reason,
      expectedCheckpointVersion: x.command.expectedCheckpointVersion,
      expectedControlVersion: x.command.expectedControlVersion
    }, { actorId: x.actorId, tenantId: x.tenantId });
    check(response.status === 409 && response.body.code === "RECOVERY_CONFLICT",
      "stale evidence responds with sanitized conflict");
    check(!x.f.loadCommand(x.command.commandId) &&
      !x.f.loadControl(x.runId) && x.f.countOutbox() === 0,
      "ingress TOCTOU must leave zero Command/Control/Outbox");
    passed++;
  } finally { checkpointsDb.close(); x.close(); }
}
console.log(`Day 69 noon same-SQLite authorized Claim: ${passed}/${passed} passed (candidate local authority only)`);
