import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { InMemoryRecoveryControlStore } from "../runtime/recovery-operations.js";
import { DurableRecoveryOperationOrchestrator } from "../runtime/durable-recovery-operation-orchestrator.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import { ClaimRequiredRecoveryEntry } from "../runtime/recovery-claim-required-entry.js";
import { RecoveryIngressGate, type RecoveryIngressRequest } from "../runtime/recovery-ingress-gate.js";
import { handleRecoveryIngressResponse } from "../runtime/recovery-ingress-response.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error("Day 68 noon: " + reason);
}
let count = 0;
const now = () => "2026-10-28T04:00:00.000Z";
async function fixture() {
  await mkdir("tmp", { recursive: true });
  const id = ++count;
  const runId = `day68-noon-run-${id}`;
  const path = `tmp/day68-noon-${Date.now()}-${id}.db`;
  const checkpointDb = new SQLiteTransactionalCheckpointDatabase(path);
  const checkpoints = new TransactionalCheckpointStore(checkpointDb);
  await checkpoints.save({
    ...createInitialCheckpoint(runId), boundary: "reconciling_tool"
  }, 0);
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(path, now);
  let legacyCalls = 0;
  let authCalls = 0;
  let permitted = true;
  let tenant: string | undefined = "tenant-a";
  let runExists = true;
  const legacy = new DurableRecoveryOperationOrchestrator(
    finalizer.asLegacyCommandStore(),
    { async execute() {
      legacyCalls++;
      throw new Error("legacy must never run for atomic ingress");
    } },
    checkpoints, new InMemoryRecoveryControlStore(), { now }
  );
  const atomic = new AtomicRecoveryControlOnlyAdapter(finalizer, {
    async authorize() {
      authCalls++;
      return { allowed: true, reason: "allowed" };
    }
  }, now);
  const entry = new ClaimRequiredRecoveryEntry({ legacy, atomic }, true, finalizer);
  const gate = new RecoveryIngressGate(
    entry,
    { async findTenantId(requestedRunId) {
      check(requestedRunId === runId, "expected run directory lookup");
      return runExists ? tenant : undefined;
    } },
    { async canOperate(principal, operation) {
      return principal.tenantId === "tenant-a" &&
        operation === "quarantine" && permitted;
    } }
  );
  const request: RecoveryIngressRequest = {
    commandId: `day68-noon-cmd-${id}`, runId,
    operation: "quarantine", reason: "review uncertain effect",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const actor = { actorId: "operator-a", tenantId: "tenant-a" };
  return {
    request, actor, gate, finalizer,
    setPermitted(v: boolean) { permitted = v; },
    setTenant(v: string | undefined) { tenant = v; },
    setExists(v: boolean) { runExists = v; },
    counts: () => ({ authCalls, legacyCalls }),
    close() { finalizer.close(); checkpointDb.close(); }
  };
}
let passed = 0;
{
  const f = await fixture();
  try {
    // Bad or untrusted requests must leave no durable Command/Control/Outbox.
    const denied = [
      [{ ...f.request, requestedBy: "admin" }, f.actor, 400, "BAD_REQUEST"],
      [f.request, undefined, 401, "UNAUTHENTICATED"],
      [{ ...f.request, expectedControlVersion: "0" }, f.actor, 400, "BAD_REQUEST"]
    ] as const;
    for (const [body, actor, status, code] of denied) {
      const response = await handleRecoveryIngressResponse(f.gate, body, actor);
      check(response.status === status && response.body.code === code, "deny response code");
      check(!f.finalizer.loadCommand(f.request.commandId) &&
        !f.finalizer.loadControl(f.request.runId) &&
        f.finalizer.countOutbox() === 0, "denied before SQLite admission");
      passed++;
    }
    f.setTenant("tenant-b");
    const foreign = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(foreign.status === 404 && foreign.body.code === "NOT_FOUND" &&
      !f.finalizer.loadCommand(f.request.commandId), "foreign run hidden");
    passed++;
    f.setExists(false);
    const missing = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(missing.status === 404 && missing.body.code === "NOT_FOUND",
      "missing and foreign runs indistinguishable");
    passed++;
    f.setExists(true); f.setTenant("tenant-a"); f.setPermitted(false);
    const forbidden = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(forbidden.status === 403 && forbidden.body.code === "FORBIDDEN" &&
      !f.finalizer.loadCommand(f.request.commandId) &&
      f.finalizer.countOutbox() === 0, "unauthorized operator has zero admission/outbox");
    passed++;
    f.setPermitted(true);
    const first = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(first.status === 200 && first.body.action === "executed_new" &&
      first.body.result?.status === "quarantined", "authorized first operation");
    check(f.finalizer.loadCommand(f.request.commandId)?.requestedBy === "operator-a" &&
      f.finalizer.loadCommand(f.request.commandId)?.version === 3 &&
      f.finalizer.loadControl(f.request.runId)?.version === 1 &&
      f.finalizer.countOutbox() === 1 &&
      f.counts().authCalls === 1 && f.counts().legacyCalls === 0,
      "command identity, finalizer and single outbox persisted");
    passed++;
    const replay = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(replay.status === 200 && replay.body.action === "replayed_terminal" &&
      replay.body.result?.controlVersion === 1 &&
      f.finalizer.countOutbox() === 1 && f.counts().authCalls === 1,
      "replay is authorized and does not execute twice");
    passed++;
    // Permission revocation MUST stop even a terminal replay from returning snapshot.
    f.setPermitted(false);
    const revoked = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(revoked.status === 403 && !revoked.body.result &&
      f.finalizer.countOutbox() === 1 && f.counts().authCalls === 1,
      "revocation blocks terminal snapshot without new writes");
    passed++;
    f.setPermitted(true);
    const changedActor = await handleRecoveryIngressResponse(
      f.gate, f.request, { ...f.actor, actorId: "operator-b" }
    );
    check(changedActor.status === 409 && changedActor.body.code === "RECOVERY_CONFLICT" &&
      !changedActor.body.result, "identity mismatch after reauthorization");
    passed++;
    const changedReason = await handleRecoveryIngressResponse(
      f.gate, { ...f.request, reason: "different purpose" }, f.actor
    );
    check(changedReason.status === 409 && changedReason.body.code === "RECOVERY_CONFLICT" &&
      f.finalizer.countOutbox() === 1, "immutable reason mismatch denied");
    passed++;
    const unsupported = await handleRecoveryIngressResponse(
      f.gate, { ...f.request, commandId: "new-unsupported", operation: "resume" }, f.actor
    );
    check(unsupported.status === 403 && !f.finalizer.loadCommand("new-unsupported"),
      "policy denies operation before Claim");
    passed++;
  } finally { f.close(); }
}
// An executing command is an ambiguous durable fact, not a retry permit.
{
  const f = await fixture();
  try {
    const claim = await f.finalizer.claim({
      ...f.request, requestedBy: f.actor.actorId
    }, "atomic_control_only");
    check(claim.action === "claimed_executing", "seed in-flight command");
    const response = await handleRecoveryIngressResponse(f.gate, f.request, f.actor);
    check(response.status === 202 && response.body.code === "IN_FLIGHT" &&
      !response.body.result && f.finalizer.countOutbox() === 0 &&
      f.counts().authCalls === 0 && f.counts().legacyCalls === 0,
      "in-flight produces 202 without running executor");
    passed++;
  } finally { f.close(); }
}
console.log(`Day 68 ingress-to-SQLite authorization and replay: ${passed}/13 passed`);
