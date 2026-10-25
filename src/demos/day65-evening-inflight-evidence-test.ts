import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";
import {
  SQLiteRecoveryFinalizationUnitOfWork,
  RecoveryFinalizationConflictError
} from "../runtime/sqlite-recovery-finalization.js";
import { AtomicRecoveryControlOnlyAdapter } from "../runtime/recovery-atomic-control-only-adapter.js";
import { RecoveryTerminalSnapshotMissingError } from "../runtime/recovery-atomic-route-decision.js";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { DurableRecoveryCommandRecord } from "../runtime/recovery-command-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Day 65 evening: " + message);
}

const now = () => "2026-10-25T10:00:00.000Z";
const allow = { authorize: async () => ({ allowed: true, reason: "allowed" }) };
let sequence = 0;
let passed = 0;

async function fixture(boundary: "reconciling_tool" | "completed" = "reconciling_tool") {
  await mkdir("tmp", { recursive: true });
  const n = ++sequence;
  const runId = `day65-evening-run-${n}`;
  const file = `tmp/day65-evening-${Date.now()}-${n}.db`;
  const database = new SQLiteTransactionalCheckpointDatabase(file);
  const store = new TransactionalCheckpointStore(database);
  const checkpoint = await store.save(
    { ...createInitialCheckpoint(runId), boundary }, 0
  );
  database.close();
  assert(checkpoint.version === 1, "checkpoint must start at v1");
  const finalizer = new SQLiteRecoveryFinalizationUnitOfWork(file, now);
  const command: DurableRecoveryOperationCommand = {
    commandId: `day65-evening-command-${n}`,
    runId,
    operation: "quarantine",
    requestedBy: "operator",
    reason: "manual investigation",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  };
  return { finalizer, file, command };
}

// 1. Forensic inspection must not admit or mutate a new command.
{
  const { finalizer, command } = await fixture();
  try {
    const before = finalizer.inspectInFlightEvidence(command.commandId, command.runId);
    assert(before.command === undefined && before.checkpoint?.version === 1,
      "initial read only returns existing Checkpoint");
    assert(before.control === undefined && before.outboxEventIds.length === 0,
      "inspection does not create Control or Outbox");
    assert(finalizer.loadCommand(command.commandId) === undefined,
      "inspection never admits a command");
    passed++;
  } finally { finalizer.close(); }
}

// 2. Authorizer crashes after durable Admission. Retry must suspend.
{
  const { finalizer, command } = await fixture();
  let calls = 0;
  const brokenAuthorization = {
    authorize: async () => { calls++; throw new Error("authorization_unavailable"); }
  };
  try {
    let failed = false;
    try {
      await new AtomicRecoveryControlOnlyAdapter(
        finalizer, brokenAuthorization, now
      ).execute(command, true);
    } catch (e) { failed = e instanceof Error && e.message === "authorization_unavailable"; }
    assert(failed, "authorization fault must surface, never use old handler");
    const facts = finalizer.inspectInFlightEvidence(command.commandId, command.runId);
    assert(facts.command?.status === "executing" && facts.command.version === 2,
      "in-flight v2 is durable");
    assert(facts.control === undefined && facts.outboxEventIds.length === 0,
      "before Finalizer COMMIT, there must be no partial writes");
    const retry = await new AtomicRecoveryControlOnlyAdapter(
      finalizer, brokenAuthorization, now
    ).execute(command, true);
    assert(retry.action === "suspend_in_flight" && calls === 1,
      "in-flight retry never reauthorizes or retries effect");
    passed++;
  } finally { finalizer.close(); }
}

// 3. External checkpoint update between Prepare read and COMMIT must fail CAS.
{
  const { finalizer, file, command } = await fixture();
  const racingAuthorization = {
    authorize: async () => {
      const database = new SQLiteTransactionalCheckpointDatabase(file);
      try {
        const store = new TransactionalCheckpointStore(database);
        const current = await store.load(command.runId);
        assert(current?.version === 1, "racing writer observes Checkpoint v1");
        const next = await store.save(current, 1);
        assert(next.version === 2, "racing writer advances Checkpoint to v2");
      } finally { database.close(); }
      return { allowed: true, reason: "allowed" };
    }
  };
  try {
    let conflict = false;
    try {
      await new AtomicRecoveryControlOnlyAdapter(
        finalizer, racingAuthorization, now
      ).execute(command, true);
    } catch (e) {
      conflict = e instanceof RecoveryFinalizationConflictError &&
        e.entity === "checkpoint";
    }
    assert(conflict, "stale Read Set must fail inside Finalizer");
    const facts = finalizer.inspectInFlightEvidence(command.commandId, command.runId);
    assert(facts.checkpoint?.version === 2, "competing checkpoint update persists");
    assert(facts.command?.status === "executing" && facts.command.version === 2,
      "failed finalization cannot write terminal");
    assert(facts.control === undefined && facts.outboxEventIds.length === 0,
      "Finalizer ROLLBACK leaves no Control or Outbox");
    const retry = await new AtomicRecoveryControlOnlyAdapter(
      finalizer, allow, now
    ).execute(command, true);
    assert(retry.action === "suspend_in_flight",
      "stale in-flight does not auto re-Prepare");
    passed++;
  } finally { finalizer.close(); }
}

// 4. COMMIT succeeded but reply was lost: evidence + terminal replay, no re-execution.
{
  const { finalizer, command } = await fixture();
  let authorizations = 0;
  const counted = {
    authorize: async () => {
      authorizations++;
      return { allowed: true, reason: "allowed" };
    }
  };
  try {
    let lost = false;
    try {
      await new AtomicRecoveryControlOnlyAdapter(
        finalizer, counted, now, () => { throw new Error("lost_http_response"); }
      ).execute(command, true);
    } catch (e) { lost = e instanceof Error && e.message === "lost_http_response"; }
    assert(lost, "fault must occur after COMMIT");
    const facts = finalizer.inspectInFlightEvidence(command.commandId, command.runId);
    assert(facts.command?.status === "succeeded" && facts.command.version === 3,
      "terminal v3 is durable despite response loss");
    assert(facts.control?.version === 1 && facts.checkpoint?.version === 1,
      "only Control changes for quarantine");
    assert(facts.outboxEventIds.length === 1, "terminal Outbox event exists");
    const replay = await new AtomicRecoveryControlOnlyAdapter(
      finalizer, counted, now
    ).execute(command, true);
    assert(replay.action === "replayed_terminal" && authorizations === 1,
      "replay skips authorization and does not write terminal twice");
    assert(finalizer.countOutbox() === 1, "replay adds no second event");
    passed++;
  } finally { finalizer.close(); }
}

// 5. Evidence read refuses a commandId/runId mismatch without writing.
{
  const { finalizer, command } = await fixture();
  try {
    await new AtomicRecoveryControlOnlyAdapter(finalizer, allow, now)
      .execute(command, true);
    let mismatch = false;
    try { finalizer.inspectInFlightEvidence(command.commandId, "other-run"); }
    catch (e) {
      mismatch = e instanceof RecoveryFinalizationConflictError &&
        e.entity === "evidence_run_identity";
    }
    assert(mismatch, "inspection must not expose another run's evidence");
    assert(finalizer.countOutbox() === 1,
      "failed inspection does not alter committed event");
    passed++;
  } finally { finalizer.close(); }
}

// 6. Corrupt terminal without ResultSnapshot must not trigger another execution.
{
  const { finalizer, command } = await fixture();
  let calls = 0;
  const counted = {
    authorize: async () => { calls++; return { allowed: true, reason: "allowed" }; }
  };
  try {
    const stored: DurableRecoveryCommandRecord = {
      ...command, status: "succeeded", version: 0,
      createdAt: now(), updatedAt: now()
    };
    assert(finalizer.insertCommandIfAbsent(stored), "seed terminal record");
    let missing = false;
    try {
      await new AtomicRecoveryControlOnlyAdapter(finalizer, counted, now)
        .execute(command, true);
    } catch (e) { missing = e instanceof RecoveryTerminalSnapshotMissingError; }
    assert(missing, "terminal without durable snapshot fails closed");
    const facts = finalizer.inspectInFlightEvidence(command.commandId, command.runId);
    assert(facts.command?.status === "succeeded" && !facts.command.resultSnapshot,
      "evidence exposes missing snapshot without fabricating it");
    assert(calls === 0 && facts.outboxEventIds.length === 0,
      "no retry or synthetic audit event");
    passed++;
  } finally { finalizer.close(); }
}

console.log(`Day 65 evening in-flight evidence and replay: ${passed}/6 passed`);
