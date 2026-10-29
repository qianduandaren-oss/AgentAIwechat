import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import {
  RecoveryAuthorizationEvidenceConflictError,
  type RecoveryAuthorizationEvidence
} from "../runtime/recovery-authorization-evidence.js";
import {
  SQLiteRecoveryFinalizationUnitOfWork
} from "../runtime/sqlite-recovery-finalization.js";

function check(value: unknown, why: string): asserts value {
  if (!value) throw new Error("Day 69 evening Finalizer auth fence: " + why);
}
const now = () => "2026-10-29T10:00:00.000Z";
let serial = 0;
let passed = 0;

async function fixture() {
  await mkdir("tmp", { recursive: true });
  const id = ++serial;
  const path = "tmp/day69-evening-" + Date.now() + "-" + id + ".db";
  const runId = "day69-evening-run-" + id;
  const actorId = "operator-a";
  const tenantId = "tenant-a";
  const cpDb = new SQLiteTransactionalCheckpointDatabase(path);
  const checkpoints = new TransactionalCheckpointStore(cpDb);
  await checkpoints.save({
    ...createInitialCheckpoint(runId), boundary: "reconciling_tool"
  }, 0);
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(path, now);
  const admin = new DatabaseSync(path);
  admin.exec("PRAGMA busy_timeout = 5000;");
  admin.prepare(
    "INSERT INTO recovery_authority_runs (run_id,tenant_id,tenant_revision,acl_revision) VALUES (?, ?, 4, 11)"
  ).run(runId, tenantId);
  admin.prepare(
    "INSERT INTO recovery_authority_actor_grants (actor_id,tenant_id,operation,grant_revision,allowed) VALUES (?, ?, 'quarantine', 9, 1)"
  ).run(actorId, tenantId);
  admin.prepare(
    "INSERT INTO recovery_authority_run_permissions (run_id,actor_id,operation,allowed) VALUES (?, ?, 'quarantine', 1)"
  ).run(runId, actorId);
  const command: DurableRecoveryOperationCommand = {
    commandId: "day69-evening-command-" + id,
    runId, requestedBy: actorId, operation: "quarantine",
    reason: "investigate ambiguous recovery",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const evidence: RecoveryAuthorizationEvidence = {
    actorId, tenantId, runId, operation: "quarantine", allowed: true,
    revisions: {
      runTenantRevision: 4, runAclRevision: 11, actorGrantRevision: 9
    }
  };
  let authorizations = 0;
  const adapter = new AtomicRecoveryControlOnlyAdapter(
    finalizer, { async authorize() {
      authorizations++;
      return { allowed: true, reason: "allowed" };
    } }, now
  );
  return {
    finalizer, admin, cpDb, command, evidence, adapter,
    counts: () => authorizations,
    close() { admin.close(); finalizer.close(); cpDb.close(); }
  };
}

async function claim(x: Awaited<ReturnType<typeof fixture>>) {
  const c = await x.finalizer.claimAuthorized(
    x.command, "atomic_control_only", x.evidence
  );
  check(c.action === "claimed_executing", "fresh authorized first Claim");
  check(c.record.authorizationFence === "same_sqlite" &&
    !!c.authorizationEvidence, "fenced Claim carries trusted evidence");
  return c;
}
function unfinished(x: Awaited<ReturnType<typeof fixture>>, label: string) {
  const command = x.finalizer.loadCommand(x.command.commandId);
  check(command?.status === "executing" && command.version === 2 &&
    command.authorizationFence === "same_sqlite",
    label + ": persisted executing v2, not a forged terminal");
  check(!x.finalizer.loadControl(x.command.runId) &&
    x.finalizer.countOutbox() === 0 &&
    x.finalizer.loadCheckpoint(x.command.runId)?.version === 1,
    label + ": no Control/Outbox writes and Checkpoint unchanged");
}
async function rejected(
  label: string,
  mutate: (x: Awaited<ReturnType<typeof fixture>>) => void
) {
  const x = await fixture();
  try {
    const c = await claim(x);
    // The trusted administrator commits a change AFTER Claim but BEFORE
    // the Finalizer begins its separate BEGIN IMMEDIATE transaction.
    mutate(x);
    let denied = false;
    try { await x.adapter.executeClaimed(x.command, c); }
    catch (error) {
      denied = error instanceof RecoveryAuthorizationEvidenceConflictError;
    }
    check(denied, label + ": Finalizer must reject stale permission");
    unfinished(x, label);
    check(x.counts() === 1, label + ": no legacy fallback or repeat");
    passed++;
  } finally { x.close(); }
}

// 1. Fresh Claim + fresh authority -> atomic terminal, Control and Outbox.
{
  const x = await fixture();
  try {
    const c = await claim(x);
    const result = await x.adapter.executeClaimed(x.command, c);
    check(result.action === "executed_new", "fresh fence commits");
    check(x.finalizer.loadControl(x.command.runId)?.version === 1 &&
      x.finalizer.countOutbox() === 1, "one durable Control/Outbox");
    const stored = x.finalizer.loadCommand(x.command.commandId);
    check(stored?.status === "succeeded" && stored.version === 3 &&
      stored.authorizationFence === "same_sqlite",
      "fence survives into terminal record");
    passed++;
  } finally { x.close(); }
}

// 2-5. A committed permission change after Claim aborts finalization.
await rejected("grant revoked", x => {
  x.admin.prepare(
    "UPDATE recovery_authority_actor_grants SET grant_revision = 10, allowed = 0 WHERE actor_id = ?"
  ).run(x.evidence.actorId);
});
await rejected("Run ACL revision changed", x => {
  x.admin.prepare(
    "UPDATE recovery_authority_runs SET acl_revision = 12 WHERE run_id = ?"
  ).run(x.command.runId);
});
await rejected("Run tenant changed", x => {
  x.admin.prepare(
    "UPDATE recovery_authority_runs SET tenant_id = 'tenant-b', tenant_revision = 5 WHERE run_id = ?"
  ).run(x.command.runId);
});
await rejected("revoke with broken unchanged revision", x => {
  x.admin.prepare(
    "UPDATE recovery_authority_run_permissions SET allowed = 0 WHERE run_id = ?"
  ).run(x.command.runId);
});

// 6. A claimed/fenced command cannot be finalized after dropping the
// in-memory trusted evidence, even with unchanged ACL and normal authorizer.
{
  const x = await fixture();
  try {
    const c = await claim(x);
    let denied = false;
    try {
      await x.adapter.executeClaimed(x.command, {
        action: "claimed_executing",
        owner: c.owner, record: c.record
      });
    } catch (error) {
      denied = error instanceof RecoveryAuthorizationEvidenceConflictError;
    }
    check(denied, "missing evidence fails closed at terminal transaction");
    unfinished(x, "missing evidence");
    passed++;
  } finally { x.close(); }
}

// 7. Permission changes while awaiting a business authorizer. The Finalizer
// still detects the newer authority and makes ZERO business state writes.
{
  const x = await fixture();
  try {
    const c = await claim(x);
    const injected = new AtomicRecoveryControlOnlyAdapter(
      x.finalizer, { async authorize() {
        x.admin.prepare(
          "UPDATE recovery_authority_actor_grants SET grant_revision = 10, allowed = 0 WHERE actor_id = ?"
        ).run(x.evidence.actorId);
        return { allowed: true, reason: "business authorizer had old access" };
      } }, now
    );
    let denied = false;
    try { await injected.executeClaimed(x.command, c); }
    catch (error) {
      denied = error instanceof RecoveryAuthorizationEvidenceConflictError;
    }
    check(denied, "revocation during authorization aborts Finalizer");
    unfinished(x, "revoked while authorizing");
    passed++;
  } finally { x.close(); }
}

// 8. A successfully committed terminal is not rolled back by later revoke,
// but a later authorized replay must reject stale permissions.
{
  const x = await fixture();
  try {
    const c = await claim(x);
    await x.adapter.executeClaimed(x.command, c);
    x.admin.prepare(
      "UPDATE recovery_authority_actor_grants SET grant_revision = 10, allowed = 0 WHERE actor_id = ?"
    ).run(x.evidence.actorId);
    let denied = false;
    try {
      await x.finalizer.claimAuthorized(
        x.command, "atomic_control_only", x.evidence
      );
    } catch (error) {
      denied = error instanceof RecoveryAuthorizationEvidenceConflictError;
    }
    check(denied, "revoked operator cannot replay durable result");
    check(x.finalizer.loadCommand(x.command.commandId)?.status === "succeeded" &&
      x.finalizer.countOutbox() === 1, "legitimate earlier COMMIT remains intact");
    passed++;
  } finally { x.close(); }
}

console.log("Day 69 evening Finalizer authorization fence: " +
  passed + "/8 passed (same-SQLite candidate only)");
