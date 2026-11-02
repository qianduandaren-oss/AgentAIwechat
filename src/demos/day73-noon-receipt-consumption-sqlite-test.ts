import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { planRemoteReceiptConsumption } from "../runtime/recovery-remote-receipt-consumption.js";
import { SQLiteRecoveryRemoteReceiptFinalizer, RemoteReceiptFinalizationConflict } from "../runtime/recovery-remote-receipt-finalizer.js";
import { DatabaseSync } from "node:sqlite";
import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryAuthorizationEvidence } from "../runtime/recovery-authorization-evidence.js";
import {
  SQLiteRecoveryExternalEffectLedger,
  type RecoveryRemoteReceiptTerminalReview
} from "../runtime/recovery-external-effect-ledger.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryExternalEffectIntent } from "../runtime/recovery-external-effect-fence.js";
import type { RecoveryRemoteAppliedReceipt, RecoveryRemoteReceiptReviewInput } from "../runtime/recovery-remote-receipt-review.js";
import type { RecoveryProviderConformanceRegistry, RecoveryProviderProbeEvidence } from "../runtime/recovery-provider-conformance-gate.js";
import type { RecoveryProviderCapabilityProfile } from "../runtime/recovery-provider-capability-contract.js";

const now = Date.UTC(2026, 10, 1, 10, 0);
const profile: RecoveryProviderCapabilityProfile = {
  providerId: "provider-a", source: "verified_server_adapter",
  capabilities: { atomicIdempotency: true, epochFencing: true, statusQuery: "authoritative_final" },
  stableReceiptIdentity: true, finalNegativeNoLateCommit: true,
  idempotencyScope: "effect", idempotencyRetentionSeconds: 7200
};
const observed = {
  sameKeyDeduplicatedAtSink: true, staleEpochRejectedAtSink: true,
  authoritativeFinalQuery: true, receiptBoundToEffect: true,
  noLateCommitAfterFinalNegative: true, effectScopedKey: true,
  retentionCoversRecoveryWindow: true
};
let sequence = 0;
let checks = 0;

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error("Day 73 noon: " + label);
}
function expectHold(result: RecoveryRemoteReceiptTerminalReview,
                    reason: Extract<RecoveryRemoteReceiptTerminalReview,
                      { action: "hold" }>["reason"]): void {
  check(result.action === "hold" && result.reason === reason,
    "expected hold:" + reason + ", got " + JSON.stringify(result));
}
async function fixture(persist = true) {
  await mkdir("tmp", { recursive: true });
  const i = ++sequence;
  const dbFile = "tmp/day72-evening-" + Date.now() + "-" + i + ".db";
  const unit = new SQLiteRecoveryFinalizationUnitOfWork(dbFile);
  const admin = new DatabaseSync(dbFile);
  admin.exec("PRAGMA busy_timeout = 5000");
  const command: DurableRecoveryOperationCommand = {
    commandId: "command-day72-evening-" + i,
    runId: "run-day72-evening-" + i,
    operation: "quarantine", requestedBy: "operator-a",
    reason: "provider applied but ack lost",
    expectedCheckpointVersion: 1, expectedControlVersion: 0
  };
  const cp = { ...createInitialCheckpoint(command.runId), version: 1, boundary: "reconciling_tool" as const };
  admin.prepare("INSERT INTO agent_checkpoints (run_id,version,payload,updated_at) VALUES (?,1,?,?)")
    .run(command.runId, JSON.stringify(cp), cp.updatedAt);
  const evidence: RecoveryAuthorizationEvidence = {
    actorId: "operator-a", tenantId: "tenant-a",
    runId: command.runId, operation: command.operation, allowed: true,
    revisions: { runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9 }
  };
  admin.prepare("INSERT INTO recovery_authority_runs (run_id,tenant_id,tenant_revision,acl_revision) VALUES (?,'tenant-a',3,5)").run(command.runId);
  admin.prepare("INSERT INTO recovery_authority_actor_grants (actor_id,tenant_id,operation,grant_revision,allowed) VALUES ('operator-a','tenant-a','quarantine',9,1)").run();
  admin.prepare("INSERT INTO recovery_authority_run_permissions (run_id,actor_id,operation,allowed) VALUES (?,'operator-a','quarantine',1)").run(command.runId);
  const claimed = await unit.claimAuthorized(command, "atomic_control_only", evidence);
  check(claimed.action === "claimed_executing", "authorized command claimed");
  const ledger = new SQLiteRecoveryExternalEffectLedger(dbFile);
  const second = new SQLiteRecoveryExternalEffectLedger(dbFile);
  const intent: RecoveryExternalEffectIntent = {
    command, owner: "atomic_control_only", authorizationEvidence: evidence,
    effectId: "notify:" + command.commandId,
    idempotencyKey: command.commandId + ":notify"
  };
  ledger.stageIntent(intent);
  const got = ledger.claimDispatch(intent.effectId, "worker-a");
  check(got.action === "claimed", "effect leased");
  ledger.markUnknown(intent.effectId, got.fence.epoch);
  const fence = got.fence;

  const state = { revision: 1, unresolved: false, down: false, testedAt: now - 500 };
  const registry: RecoveryProviderConformanceRegistry = {
    getVerifiedProfile: id => {
      if (state.down) throw Error("authority unavailable");
      return id === "provider-a" ? profile : undefined;
    },
    getCurrentProfileRevision: () => state.revision,
    getLatestProbe: id => id === "provider-a" ? ({
      providerId: "provider-a", source: "trusted_server_test_harness",
      profileRevision: 1, testedAtEpochMs: state.testedAt,
      result: "passed", observed
    } satisfies RecoveryProviderProbeEvidence) : undefined,
    getUnresolvedViolations: () => state.unresolved ? ["duplicate_effect"] : []
  };
  const receipt: RecoveryRemoteAppliedReceipt = {
    source: "authenticated_server_adapter",
    providerId: "provider-a", profileRevision: 1,
    receiptId: "remote-receipt-" + i,
    commandId: command.commandId, runId: command.runId,
    operation: command.operation, actorId: "operator-a",
    tenantId: "tenant-a", owner: "atomic_control_only",
    effectId: intent.effectId, idempotencyKey: intent.idempotencyKey,
    epoch: fence.epoch, observedAtEpochMs: now - 10
  };
  const write: Omit<RecoveryRemoteReceiptReviewInput, "ledger"> = {
    intent, fence, providerId: "provider-a", receipt,
    recoveryWindowSeconds: 3600, nowEpochMs: now,
    maxProbeAgeMs: 60_000, maxObservationAgeMs: 30_000
  };
  if (persist) check(
    ledger.persistReviewedRemoteAppliedReceipt(registry, write) === "stored",
    "trusted applied receipt durably stored"
  );
  const reviewInput = {
    intent, fence, providerId: "provider-a",
    recoveryWindowSeconds: 3600, nowEpochMs: now, maxProbeAgeMs: 60_000
  };
  const review = () => ledger.reviewRemoteReceiptTerminalReadiness(registry, reviewInput);
  return {
    dbFile, ledger, second, unit, admin, command, intent, fence, receipt, registry,
    state, reviewInput, review,
    close() { second.close(); ledger.close(); admin.close(); unit.close(); }
  };
}

async function scenario(name: string, execute: (x: Awaited<ReturnType<typeof fixture>>) => void,
                        persist = true) {
  const x = await fixture(persist);
  try { execute(x); checks++; }
  finally { x.close(); }
  console.log("PASS " + name);
}


type Fixture = Awaited<ReturnType<typeof fixture>>;
function makeInput(x: Fixture) {
  const plan = planRemoteReceiptConsumption({
    intent: x.intent, fence: x.fence, providerId: "provider-a", review: x.review()
  });
  check(plan.action === "requires_atomic_receipt_consumption", "plan ready");
  return {
    intent: x.intent, fence: x.fence, providerId: "provider-a", plan,
    recoveryWindowSeconds: 3600, nowEpochMs: now, maxProbeAgeMs: 60_000,
    timestamp: new Date(now).toISOString()
  };
}
function expectDenied(fn: () => unknown, label: string) {
  let denied = false;
  try { fn(); } catch (e) { denied = e instanceof RemoteReceiptFinalizationConflict; }
  check(denied, label);
}
function facts(x: Fixture) {
  const cmd = x.admin.prepare("SELECT version,payload FROM recovery_commands WHERE command_id=?")
    .get(x.command.commandId) as { version: number; payload: string };
  const ctl = x.admin.prepare("SELECT version,payload FROM recovery_controls WHERE run_id=?")
    .get(x.command.runId) as { version: number; payload: string } | undefined;
  const out = x.admin.prepare("SELECT count(*) AS n FROM recovery_outbox")
    .get() as { n: number };
  return { cmd, ctl, out: out.n, effect: x.ledger.inspect(x.intent.effectId) };
}

await scenario("receipt + Control + Command + Outbox commit atomically", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const result = f.finalize(x.registry, makeInput(x));
    check(result.action === "committed" && result.commandVersion === 3, "committed");
    const s = facts(x);
    check(s.effect?.status === "committed" && s.cmd.version === 3, "terminal");
    check(JSON.parse(s.cmd.payload).status === "succeeded", "success snapshot");
    check(s.ctl?.version === 1 && JSON.parse(s.ctl.payload).causedByCommandId === x.command.commandId, "control CAS");
    check(s.out === 1 && f.inspectConsumption(x.intent.effectId)?.receipt_id === x.receipt.receiptId, "unique receipt and outbox");
  } finally { f.close(); }
});
await scenario("second worker replays existing terminal without extra Outbox", x => {
  const a = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  const b = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    check(a.finalize(x.registry, input).action === "committed", "first");
    check(b.finalize(x.registry, input).action === "replayed_terminal", "replay");
    check(facts(x).out === 1, "one outbox");
  } finally { a.close(); b.close(); }
});
await scenario("revocation after receipt persistence prevents terminal", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    x.admin.exec("UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10");
    expectDenied(() => f.finalize(x.registry, input), "revoked");
    check(!f.inspectConsumption(x.intent.effectId) && facts(x).cmd.version === 2 && facts(x).out === 0, "rollback");
  } finally { f.close(); }
});
await scenario("Control version drift prevents consumption", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    x.admin.prepare("INSERT INTO recovery_controls (run_id,version,payload,updated_at) VALUES (?,1,'{}','test')").run(x.command.runId);
    expectDenied(() => f.finalize(x.registry, input), "control changed");
    check(!f.inspectConsumption(x.intent.effectId) && facts(x).out === 0, "no partial");
  } finally { f.close(); }
});
await scenario("Checkpoint version drift prevents consumption", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    x.admin.prepare("UPDATE agent_checkpoints SET version=2 WHERE run_id=?").run(x.command.runId);
    expectDenied(() => f.finalize(x.registry, input), "checkpoint changed");
    check(facts(x).cmd.version === 2 && facts(x).out === 0, "no terminal");
  } finally { f.close(); }
});
await scenario("Provider conformance revision drift fails closed", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    x.state.revision = 2;
    expectDenied(() => f.finalize(x.registry, input), "provider drift");
    check(!f.inspectConsumption(x.intent.effectId), "not consumed");
  } finally { f.close(); }
});
await scenario("fault after receipt consumption insert rolls back everything", x => {
  const fault = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile, () => { throw Error("crash"); });
  const good = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    expectDenied(() => fault.finalize(x.registry, input), "injected crash");
    const s = facts(x);
    check(!fault.inspectConsumption(x.intent.effectId) && s.effect?.status === "unknown" &&
      s.cmd.version === 2 && s.out === 0 && !s.ctl, "all rollback");
    check(good.finalize(x.registry, input).action === "committed", "retry after rollback");
  } finally { fault.close(); good.close(); }
});
await scenario("wrong receipt ID in stale plan cannot be consumed", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    const plan = { ...input.plan, receiptId: "different" };
    expectDenied(() => f.finalize(x.registry, { ...input, plan }), "receipt mismatch");
    check(facts(x).out === 0, "no outbox");
  } finally { f.close(); }
});
await scenario("pre-existing outbox identity collision rolls back", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    const id = x.command.commandId + ":remote-receipt-terminal";
    x.admin.prepare("INSERT INTO recovery_outbox (id,event_id,command_id,run_id,payload,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, "preexisting-event", x.command.commandId, x.command.runId, "{}", "test");
    expectDenied(() => f.finalize(x.registry, input), "outbox conflict");
    check(!f.inspectConsumption(x.intent.effectId) && facts(x).cmd.version === 2 &&
      facts(x).effect?.status === "unknown", "rolled back control command consumption");
  } finally { f.close(); }
});
await scenario("restart preserves consumption and allows stable replay", x => {
  const input = makeInput(x);
  const a = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  check(a.finalize(x.registry, input).action === "committed", "first");
  a.close();
  const b = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    check(b.finalize(x.registry, input).action === "replayed_terminal", "after restart");
    check(facts(x).out === 1, "still one event");
  } finally { b.close(); }
});
await scenario("revocation after success denies a new replay request", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    f.finalize(x.registry, input);
    x.admin.exec("UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10");
    expectDenied(() => f.finalize(x.registry, input), "replay ACL");
    check(facts(x).cmd.version === 3 && facts(x).out === 1, "history remains");
  } finally { f.close(); }
});
await scenario("no receipt cannot finalize", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = { ...makeInput(x) };
    x.admin.prepare("DELETE FROM recovery_remote_applied_receipts WHERE effect_id=?").run(x.intent.effectId);
    expectDenied(() => f.finalize(x.registry, input), "missing receipt");
    check(facts(x).effect?.status === "unknown", "still unknown");
  } finally { f.close(); }
});
console.log("Day 73 noon: " + checks + " SQLite finalization scenarios passed");
