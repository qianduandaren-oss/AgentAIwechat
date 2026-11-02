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
  if (!ok) throw new Error("Day 73 evening: " + label);
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


import { RecoveryFinalizationConflictError, type RecoveryFinalizationInput } from "../runtime/sqlite-recovery-finalization.js";

await scenario("generic Finalizer cannot bypass an effect-backed receipt consumption", x => {
  // Intentionally minimal draft: this guard must run before any generic
  // Control/Command/Outbox writes or draft interpretation.
  let blocked = false;
  try {
    x.unit.commit({ command: x.command } as unknown as RecoveryFinalizationInput);
  } catch (error) {
    blocked = error instanceof RecoveryFinalizationConflictError &&
      error.entity === "effect_requires_receipt_consumption";
  }
  check(blocked, "generic writer must refuse effect-backed Command");
  const state = facts(x);
  check(state.cmd.version === 2 && state.effect?.status === "unknown" &&
    state.out === 0, "generic bypass did not change state");
});

await scenario("tampered Outbox receipt cannot be accepted as stable replay", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    check(f.finalize(x.registry, input).action === "committed", "initial commit");
    const row = x.admin.prepare("SELECT id,payload FROM recovery_outbox WHERE command_id=?")
      .get(x.command.commandId) as { id: string; payload: string };
    const event = JSON.parse(row.payload) as { payload: string };
    const evidence = JSON.parse(event.payload) as { receiptId: string };
    evidence.receiptId = "unrelated-receipt";
    event.payload = JSON.stringify(evidence);
    x.admin.prepare("UPDATE recovery_outbox SET payload=? WHERE id=?")
      .run(JSON.stringify(event), row.id);
    expectDenied(() => f.finalize(x.registry, input), "tampered outbox must block replay");
    check(facts(x).out === 1, "no duplicate event after tampering");
  } finally { f.close(); }
});

await scenario("tampered Consumption receipt binding cannot be replayed", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    check(f.finalize(x.registry, input).action === "committed", "initial commit");
    x.admin.prepare("UPDATE recovery_remote_receipt_consumptions SET receipt_id=? WHERE effect_id=?")
      .run("other-receipt", x.intent.effectId);
    expectDenied(() => f.finalize(x.registry, input), "tampered consumption must block replay");
    check(facts(x).out === 1, "no extra outbox");
  } finally { f.close(); }
});

await scenario("tampered Outbox event identity cannot be replayed", x => {
  const f = new SQLiteRecoveryRemoteReceiptFinalizer(x.dbFile);
  try {
    const input = makeInput(x);
    check(f.finalize(x.registry, input).action === "committed", "initial commit");
    x.admin.prepare("UPDATE recovery_outbox SET event_id=? WHERE command_id=?")
      .run("unrelated-event", x.command.commandId);
    expectDenied(() => f.finalize(x.registry, input), "wrong event id must block replay");
    check(facts(x).out === 1, "no duplicate outbox");
  } finally { f.close(); }
});

console.log("Day 73 evening: " + checks + " additional SQLite boundary scenarios passed");
