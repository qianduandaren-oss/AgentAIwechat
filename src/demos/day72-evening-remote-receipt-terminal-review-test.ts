import { mkdir } from "node:fs/promises";
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
  if (!ok) throw new Error("Day 72 evening: " + label);
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
    ledger, second, unit, admin, command, intent, fence, receipt, registry,
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

await scenario("valid receipt is only an advisory terminal candidate", x => {
  const result = x.review();
  check(result.action === "requires_atomic_terminal_transaction", "candidate not terminal");
  check(result.expectedCommandVersion === 2 && result.expectedControlVersion === 0,
    "CAS expectations carried");
  check(x.ledger.inspect(x.intent.effectId)?.status === "unknown",
    "no Effect write");
  const command = x.admin.prepare("SELECT version,payload FROM recovery_commands WHERE command_id=?")
    .get(x.command.commandId) as { version: number; payload: string };
  check(command.version === 2 && JSON.parse(command.payload).status === "executing",
    "no Command terminal");
  check(x.admin.prepare("SELECT count(*) AS n FROM recovery_outbox").get() !== undefined,
    "existing Outbox readable");
});
await scenario("no remote receipt never becomes terminal candidate",
  x => expectHold(x.review(), "receipt_missing_or_mismatched"), false);
await scenario("grant revoked after receipt stored must stop",
  x => {
    x.admin.exec("UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10 WHERE actor_id='operator-a'");
    expectHold(x.review(), "local_authority_changed");
    check(x.ledger.countRemoteReceipts() === 1, "historic receipt retained");
  });
await scenario("Run permission revoked after receipt stored must stop",
  x => {
    x.admin.exec("UPDATE recovery_authority_run_permissions SET allowed=0 WHERE actor_id='operator-a'");
    expectHold(x.review(), "local_authority_changed");
  });
await scenario("ACL revision changes even with allowed still true",
  x => {
    x.admin.exec("UPDATE recovery_authority_runs SET acl_revision=6");
    expectHold(x.review(), "local_authority_changed");
  });
await scenario("tenant changes after applied receipt",
  x => {
    x.admin.exec("UPDATE recovery_authority_runs SET tenant_id='tenant-b',tenant_revision=4");
    expectHold(x.review(), "local_authority_changed");
  });
await scenario("Control CAS version conflict blocks candidate",
  x => {
    x.admin.prepare("INSERT INTO recovery_controls (run_id,version,payload,updated_at) VALUES (?,1,'{}','test')")
      .run(x.command.runId);
    expectHold(x.review(), "control_cas_conflict");
  });
await scenario("Command terminal transition disqualifies in-flight handoff",
  x => {
    const row = x.admin.prepare("SELECT payload FROM recovery_commands WHERE command_id=?")
      .get(x.command.commandId) as { payload: string };
    const payload = { ...JSON.parse(row.payload), status: "succeeded", version: 3 };
    x.admin.prepare("UPDATE recovery_commands SET version=3,payload=? WHERE command_id=?")
      .run(JSON.stringify(payload), x.command.commandId);
    expectHold(x.review(), "local_authority_changed");
  });
await scenario("Provider revision drift blocks stale receipt",
  x => {
    x.state.revision = 2;
    expectHold(x.review(), "provider_conformance_denied");
  });
await scenario("unresolved duplicate-effect incident quarantines provider",
  x => {
    x.state.unresolved = true;
    expectHold(x.review(), "provider_conformance_denied");
  });
await scenario("stale conformance probe blocks provider",
  x => {
    x.state.testedAt = now - 120_000;
    expectHold(x.review(), "provider_conformance_denied");
  });
await scenario("provider authority outage fails closed",
  x => {
    x.state.down = true;
    expectHold(x.review(), "provider_conformance_denied");
  });
await scenario("different epoch cannot repurpose stored receipt",
  x => {
    const wrong = { ...x.reviewInput, fence: { ...x.fence, epoch: 2 } };
    expectHold(x.ledger.reviewRemoteReceiptTerminalReadiness(x.registry, wrong), "missing_or_changed_effect");
  });
await scenario("tampered persisted receipt binding fails closed",
  x => {
    const modified = { ...x.receipt, idempotencyKey: "evil:other" };
    x.admin.prepare("UPDATE recovery_remote_applied_receipts SET receipt_json=? WHERE effect_id=?")
      .run(JSON.stringify(modified), x.intent.effectId);
    expectHold(x.review(), "receipt_missing_or_mismatched");
  });
await scenario("two readers cannot advance terminal state",
  x => {
    const a = x.ledger.reviewRemoteReceiptTerminalReadiness(x.registry, x.reviewInput);
    const b = x.second.reviewRemoteReceiptTerminalReadiness(x.registry, x.reviewInput);
    check(a.action === "requires_atomic_terminal_transaction" &&
          b.action === "requires_atomic_terminal_transaction", "both may review, neither commit");
    check(x.ledger.inspect(x.intent.effectId)?.status === "unknown", "UNKNOWN is unchanged");
    check(x.ledger.countRemoteReceipts() === 1, "receipt stable");
  });
await scenario("advisory expires after a subsequent ACL revocation", x => {
  const before = x.review();
  check(before.action === "requires_atomic_terminal_transaction",
    "review was initially eligible");
  x.admin.exec("UPDATE recovery_authority_actor_grants SET allowed=0,grant_revision=10 WHERE actor_id='operator-a'");
  expectHold(x.review(), "local_authority_changed");
  check(x.ledger.inspect(x.intent.effectId)?.status === "unknown",
    "the advisory must never commit the Effect");
  const row = x.admin.prepare("SELECT version,payload FROM recovery_commands WHERE command_id=?")
    .get(x.command.commandId) as { version: number; payload: string };
  check(row.version === 2 && JSON.parse(row.payload).status === "executing",
    "the advisory must never commit Command terminal");
});
await scenario("advisory expires after subsequent Control CAS drift", x => {
  check(x.review().action === "requires_atomic_terminal_transaction",
    "review was initially eligible");
  x.admin.prepare("INSERT INTO recovery_controls (run_id,version,payload,updated_at) VALUES (?,1,'{}','after-review')")
    .run(x.command.runId);
  expectHold(x.review(), "control_cas_conflict");
  check(x.ledger.countRemoteReceipts() === 1,
    "a stale advisory cannot overwrite the persisted receipt");
});
console.log("Day 72 evening terminal readiness: " + checks + " SQLite scenarios passed");
