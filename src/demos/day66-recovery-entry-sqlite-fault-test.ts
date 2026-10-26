import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import { RecoveryEntryDispatcher, AtomicRecoveryOperationUnsupportedError } from "../runtime/recovery-entry-dispatcher.js";
import { RecoveryCommandIdentityConflictError, type DurableRecoveryOperationCommand, type DurableRecoveryOperationExecution } from "../runtime/durable-recovery-operation-orchestrator.js";
import { RecoveryTerminalSnapshotMissingError } from "../runtime/recovery-atomic-route-decision.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";

/**
 * Day 66 noon: composition-boundary fault injection against real SQLite.
 * This is NOT a production HTTP endpoint, nor permission to enable cutover.
 */
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Day 66 noon entry integration: " + message);
}

const now = () => "2026-10-26T04:00:00.000Z";
let serial = 0;
let passed = 0;

async function fixture() {
  await mkdir("tmp", { recursive: true });
  const n = ++serial;
  const runId = `day66-noon-run-${n}`;
  const file = `tmp/day66-noon-${Date.now()}-${n}.db`;
  const database = new SQLiteTransactionalCheckpointDatabase(file);
  const store = new TransactionalCheckpointStore(database);
  try {
    const cp = await store.save({
      ...createInitialCheckpoint(runId),
      boundary: "reconciling_tool"
    }, 0);
    assert(cp.version === 1, "checkpoint starts at v1");
  } finally {
    database.close();
  }
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const command: DurableRecoveryOperationCommand = {
    commandId: `day66-noon-command-${n}`,
    runId,
    operation: "quarantine",
    requestedBy: "operator",
    reason: "investigate uncertain side effect",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  };
  let legacyCalls = 0;
  const legacy = {
    async execute(_: DurableRecoveryOperationCommand): Promise<DurableRecoveryOperationExecution> {
      legacyCalls++;
      const record: DurableRecoveryCommandRecord = {
        ...command,
        status: "executing",
        version: 2,
        createdAt: now(),
        updatedAt: now()
      };
      return {
        action: "resume_in_flight",
        record,
        facts: {
          checkpointVersion: 1,
          checkpointBoundary: "reconciling_tool",
          controlVersion: 0,
          controlStatus: "active"
        }
      };
    }
  };
  return { file, finalizer, command, legacy, legacyCalls: () => legacyCalls };
}

// 1. OFF: explicit old owner, never admits anything into atomic SQLite.
{
  const f = await fixture();
  let authorizations = 0;
  const authorizer = { authorize: async () => {
    authorizations++;
    return { allowed: true, reason: "allowed" };
  } };
  try {
    const dispatcher = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, false);
    const result = await dispatcher.execute(f.command);
    assert(result.route === "legacy", "flag OFF explicitly chooses legacy");
    assert(f.legacyCalls() === 1 && authorizations === 0,
      "flag OFF never touches atomic handler");
    assert(f.finalizer.loadCommand(f.command.commandId) === undefined,
      "flag OFF does not admit in atomic database");
    passed++;
  } finally { f.finalizer.close(); }
}

// 2. ON: real Admission, pure Prepare, selective Commit and one terminal owner.
{
  const f = await fixture();
  let authorizations = 0;
  const authorizer = { authorize: async () => {
    authorizations++;
    return { allowed: true, reason: "allowed" };
  } };
  try {
    const result = await new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, true).execute(f.command);
    assert(result.route === "atomic_control_only" &&
      result.execution.action === "executed_new",
      "flag ON goes through real atomic adapter");
    assert(f.finalizer.loadCommand(f.command.commandId)?.status === "succeeded" &&
      f.finalizer.loadCommand(f.command.commandId)?.version === 3,
      "Command terminal is durably persisted once");
    assert(f.finalizer.loadCheckpoint(f.command.runId)?.version === 1 &&
      f.finalizer.loadControl(f.command.runId)?.version === 1,
      "Control-only changes Control but not Checkpoint");
    assert(f.finalizer.countOutbox() === 1 &&
      f.legacyCalls() === 0 && authorizations === 1,
      "one Outbox, one auth, no old writer");
    passed++;
  } finally { f.finalizer.close(); }
}

// 3. A COMMIT succeeds but the response is lost. Retry must replay, never fallback.
{
  const f = await fixture();
  let authorizations = 0;
  const authorizer = { authorize: async () => {
    authorizations++;
    return { allowed: true, reason: "allowed" };
  } };
  try {
    const broken = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(
        f.finalizer, authorizer, now, () => { throw new Error("lost_reply_after_commit"); }
      )
    }, true);
    let lost = false;
    try { await broken.execute(f.command); }
    catch (e) { lost = e instanceof Error && e.message === "lost_reply_after_commit"; }
    assert(lost, "fault injected after actual database COMMIT");
    const facts = f.finalizer.inspectInFlightEvidence(f.command.commandId, f.command.runId);
    assert(facts.command?.status === "succeeded" &&
      facts.outboxEventIds.length === 1,
      "durable evidence is terminal despite lost response");

    const healthy = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, true);
    const again = await healthy.execute(f.command);
    assert(again.route === "atomic_control_only" &&
      again.execution.action === "replayed_terminal",
      "retry returns durable ResultSnapshot");
    assert(authorizations === 1 && f.legacyCalls() === 0 &&
      f.finalizer.countOutbox() === 1,
      "replay does not re-authorize, append Outbox, or call legacy");

    let mismatch = false;
    try { await healthy.execute({ ...f.command, reason: "tampered reason" }); }
    catch (e) { mismatch = e instanceof RecoveryCommandIdentityConflictError; }
    assert(mismatch && f.finalizer.countOutbox() === 1,
      "same commandId with changed identity cannot borrow result");
    passed++;
  } finally { f.finalizer.close(); }
}

// 4. Failure after Admission leaves executing v2 and blocks blind retries.
{
  const f = await fixture();
  let authorizations = 0;
  const authorizer = { authorize: async () => {
    authorizations++;
    throw new Error("authorization_unavailable");
    return { allowed: false, reason: "unreachable" };
  } };
  try {
    const dispatcher = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, true);
    let threw = false;
    try { await dispatcher.execute(f.command); }
    catch (e) { threw = e instanceof Error && e.message === "authorization_unavailable"; }
    assert(threw, "fault propagates to caller");
    const facts = f.finalizer.inspectInFlightEvidence(f.command.commandId, f.command.runId);
    assert(facts.command?.status === "executing" &&
      facts.command.version === 2 &&
      facts.control === undefined && facts.outboxEventIds.length === 0,
      "admission survives, finalization did not occur");
    const retry = await dispatcher.execute(f.command);
    assert(retry.route === "atomic_control_only" &&
      retry.execution.action === "suspend_in_flight",
      "in-flight cannot be re-executed");
    assert(authorizations === 1 && f.legacyCalls() === 0,
      "no second authorization and no fallback");
    passed++;
  } finally { f.finalizer.close(); }
}

// 5. Unsupported operation fails BEFORE either route is called.
{
  const f = await fixture();
  const authorizer = { authorize: async () => {
    throw new Error("authorization must not run");
    return { allowed: false, reason: "unreachable" };
  } };
  try {
    const dispatcher = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, true);
    let rejected = false;
    try { await dispatcher.execute({ ...f.command, operation: "resume" }); }
    catch (e) { rejected = e instanceof AtomicRecoveryOperationUnsupportedError; }
    assert(rejected && f.legacyCalls() === 0 &&
      f.finalizer.loadCommand(f.command.commandId) === undefined,
      "unsupported atomic command fails closed before Admission");
    passed++;
  } finally { f.finalizer.close(); }
}

// 6. Terminal record without ResultSnapshot must not be reconstructed.
{
  const f = await fixture();
  const authorizer = { authorize: async () => {
    throw new Error("must not re-authorize terminal command");
    return { allowed: false, reason: "unreachable" };
  } };
  try {
    assert(f.finalizer.insertCommandIfAbsent({
      ...f.command,
      status: "succeeded",
      version: 0,
      createdAt: now(),
      updatedAt: now()
    }), "seed a legacy-invalid terminal");
    const dispatcher = new RecoveryEntryDispatcher({
      legacy: f.legacy,
      atomic: new AtomicRecoveryControlOnlyAdapter(f.finalizer, authorizer, now)
    }, true);
    let missing = false;
    try { await dispatcher.execute(f.command); }
    catch (e) { missing = e instanceof RecoveryTerminalSnapshotMissingError; }
    assert(missing && f.legacyCalls() === 0 && f.finalizer.countOutbox() === 0,
      "missing snapshot fails closed with no synthetic terminal or event");
    passed++;
  } finally { f.finalizer.close(); }
}

console.log(`Day 66 entry-to-SQLite fault injection: ${passed}/6 passed`);
