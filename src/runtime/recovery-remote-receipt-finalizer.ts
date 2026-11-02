import { DatabaseSync } from "node:sqlite";
import { assertRecoveryExternalEffectFenceBinding, type RecoveryExternalEffectFence, type RecoveryExternalEffectIntent } from "./recovery-external-effect-fence.js";
import { assertRecoveryAuthorizationEvidence, assertRecoveryAuthorizationRevisionsUnchanged } from "./recovery-authorization-evidence.js";
import { reviewRecoveryProviderConformance, type RecoveryProviderConformanceRegistry } from "./recovery-provider-conformance-gate.js";
import { prepareControlOnlyRecovery } from "./recovery-control-preparation.js";
import type { RecoveryRemoteAppliedReceipt } from "./recovery-remote-receipt-review.js";
import type { RecoveryRemoteReceiptConsumptionPlan } from "./recovery-remote-receipt-consumption.js";
import type { DurableRecoveryCommandRecord } from "./recovery-command-store.js";
import type { RecoveryControlState } from "./recovery-operations.js";
import type { AgentRunCheckpoint } from "./checkpoint.js";

/**
 * Day 73 NOON candidate: receipt consumption, Control CAS, Command terminal,
 * Effect ledger status and Outbox append in ONE SQLite BEGIN IMMEDIATE.
 * The external provider registry is NOT locked by SQLite. No HTTP/CLI,
 * production provider adapter, or production release authorization is implied.
 */
export interface RemoteReceiptFinalizationInput {
  intent: RecoveryExternalEffectIntent;
  fence: RecoveryExternalEffectFence;
  providerId: string;
  plan: RecoveryRemoteReceiptConsumptionPlan;
  recoveryWindowSeconds: number;
  nowEpochMs: number;
  maxProbeAgeMs: number;
  timestamp: string;
}

export type RemoteReceiptFinalizationResult =
  | { action: "committed"; commandVersion: 3; controlVersion: number; eventId: string }
  | { action: "replayed_terminal"; commandVersion: 3; controlVersion: number; eventId: string };

export class RemoteReceiptFinalizationConflict extends Error {
  constructor(public readonly reason: string) {
    super("Remote receipt finalization denied: " + reason);
    this.name = "RemoteReceiptFinalizationConflict";
  }
}
function deny(reason: string): never { throw new RemoteReceiptFinalizationConflict(reason); }
type DbCommand = { version: number; payload: string };
type DbEffect = { status: string; epoch: number; intent_json: string; idempotency_key: string };
type DbReceipt = { provider_id: string; receipt_id: string; effect_id: string; idempotency_key: string; receipt_json: string };
type DbControl = { version: number; payload: string };
type DbConsumption = { provider_id: string; receipt_id: string; effect_id: string; command_id: string; event_id: string; control_version: number };

const CONSUMPTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_remote_receipt_consumptions (
  effect_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL UNIQUE,
  control_version INTEGER NOT NULL,
  UNIQUE(provider_id, receipt_id)
);`;

export class SQLiteRecoveryRemoteReceiptFinalizer {
  private readonly db: DatabaseSync;
  constructor(file: string, private readonly afterConsumptionWrite?: () => void) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(CONSUMPTION_SCHEMA);
  }
  close(): void { this.db.close(); }

  private assertAuthority(intent: RecoveryExternalEffectIntent): void {
    try {
      assertRecoveryAuthorizationEvidence(intent.command, {
        actorId: intent.authorizationEvidence.actorId,
        tenantId: intent.authorizationEvidence.tenantId
      }, intent.authorizationEvidence);
      const run = this.db.prepare(
        "SELECT tenant_id,tenant_revision,acl_revision FROM recovery_authority_runs WHERE run_id=?"
      ).get(intent.command.runId) as { tenant_id: string; tenant_revision: number; acl_revision: number } | undefined;
      const grant = this.db.prepare(
        "SELECT grant_revision,allowed FROM recovery_authority_actor_grants WHERE actor_id=? AND tenant_id=? AND operation=?"
      ).get(intent.authorizationEvidence.actorId, intent.authorizationEvidence.tenantId,
        intent.command.operation) as { grant_revision: number; allowed: number } | undefined;
      const permission = this.db.prepare(
        "SELECT allowed FROM recovery_authority_run_permissions WHERE run_id=? AND actor_id=? AND operation=?"
      ).get(intent.command.runId, intent.authorizationEvidence.actorId,
        intent.command.operation) as { allowed: number } | undefined;
      if (!run || run.tenant_id !== intent.authorizationEvidence.tenantId ||
          !grant || grant.allowed !== 1 || !permission || permission.allowed !== 1) deny("acl_revoked");
      assertRecoveryAuthorizationRevisionsUnchanged(intent.authorizationEvidence.revisions, {
        runTenantRevision: run.tenant_revision,
        runAclRevision: run.acl_revision,
        actorGrantRevision: grant.grant_revision
      });
    } catch { deny("authority_changed"); }
  }

  finalize(
    registry: RecoveryProviderConformanceRegistry,
    input: RemoteReceiptFinalizationInput
  ): RemoteReceiptFinalizationResult {
    const { intent, fence, plan } = input;
    try { assertRecoveryExternalEffectFenceBinding(intent, fence); }
    catch { deny("fence_invalid"); }
    if (intent.owner !== "atomic_control_only" ||
        plan.action !== "requires_atomic_receipt_consumption" ||
        plan.commandId !== intent.command.commandId ||
        plan.runId !== intent.command.runId ||
        plan.effectId !== intent.effectId ||
        plan.idempotencyKey !== intent.idempotencyKey ||
        plan.epoch !== fence.epoch ||
        plan.providerId !== input.providerId ||
        plan.expectedEffectStatus !== "unknown" ||
        plan.expectedCommandVersion !== 2 ||
        plan.expectedControlVersion !== intent.command.expectedControlVersion ||
        plan.automaticUnknownResend !== false ||
        !Number.isSafeInteger(input.nowEpochMs) ||
        !Number.isSafeInteger(input.maxProbeAgeMs) ||
        !Number.isSafeInteger(input.recoveryWindowSeconds) ||
        !Number.isFinite(Date.parse(input.timestamp))) deny("plan_invalid");

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const effect = this.db.prepare("SELECT * FROM recovery_effect_intents WHERE effect_id=?")
        .get(intent.effectId) as DbEffect | undefined;
      const receiptRow = this.db.prepare(
        "SELECT * FROM recovery_remote_applied_receipts WHERE effect_id=?"
      ).get(intent.effectId) as DbReceipt | undefined;
      if (!effect || !receiptRow ||
          effect.epoch !== fence.epoch ||
          effect.idempotency_key !== intent.idempotencyKey ||
          effect.intent_json !== JSON.stringify(intent)) deny("effect_or_receipt_changed");
      const receipt = JSON.parse(receiptRow.receipt_json) as RecoveryRemoteAppliedReceipt;
      if (receipt.source !== "authenticated_server_adapter" ||
          receipt.providerId !== input.providerId ||
          receipt.receiptId !== plan.receiptId ||
          receipt.receiptId !== receiptRow.receipt_id ||
          receiptRow.provider_id !== input.providerId ||
          receiptRow.idempotency_key !== intent.idempotencyKey ||
          receipt.commandId !== intent.command.commandId ||
          receipt.runId !== intent.command.runId ||
          receipt.operation !== intent.command.operation ||
          receipt.actorId !== intent.command.requestedBy ||
          receipt.tenantId !== intent.authorizationEvidence.tenantId ||
          receipt.owner !== intent.owner ||
          receipt.effectId !== intent.effectId ||
          receipt.idempotencyKey !== intent.idempotencyKey ||
          receipt.epoch !== fence.epoch) deny("receipt_binding");

      // Even a replay must be bound to the CURRENT local ACL, not a stale grant.
      this.assertAuthority(intent);
      const commandRow = this.db.prepare(
        "SELECT version,payload FROM recovery_commands WHERE command_id=?"
      ).get(intent.command.commandId) as DbCommand | undefined;
      if (!commandRow) deny("command_missing");
      const command = JSON.parse(commandRow.payload) as DurableRecoveryCommandRecord;
      const immutable = ["commandId", "runId", "operation", "requestedBy",
        "reason", "expectedCheckpointVersion", "expectedControlVersion"] as const;
      if (!immutable.every(k => command[k] === intent.command[k]) ||
          command.executionOwner !== "atomic_control_only" ||
          command.authorizationFence !== "same_sqlite" ||
          command.version !== commandRow.version) deny("command_identity");

      const existing = this.db.prepare(
        "SELECT * FROM recovery_remote_receipt_consumptions WHERE effect_id=?"
      ).get(intent.effectId) as DbConsumption | undefined;
      const eventId = "recovery:" + intent.command.commandId + ":remote-receipt-terminal";
      if (existing) {
        const outbox = this.db.prepare(
          "SELECT id,event_id,command_id,run_id,payload FROM recovery_outbox WHERE event_id=?"
        ).get(eventId) as { id: string; event_id: string; command_id: string; run_id: string; payload: string } | undefined;
        const outboxRecord = outbox ? JSON.parse(outbox.payload) as {
          id: string; eventId: string; commandId: string; runId: string;
          kind: string; payload: string;
        } : undefined;
        const outboxEvidence = outboxRecord
          ? JSON.parse(outboxRecord.payload) as {
              operation: string; outcome: string; receiptId: string; providerId: string;
            }
          : undefined;
        const control = this.db.prepare(
          "SELECT version,payload FROM recovery_controls WHERE run_id=?"
        ).get(intent.command.runId) as DbControl | undefined;
        const controlPayload = control ? JSON.parse(control.payload) as RecoveryControlState : undefined;
        if (effect.status !== "committed" ||
            existing.provider_id !== input.providerId ||
            existing.receipt_id !== receipt.receiptId ||
            existing.command_id !== intent.command.commandId ||
            existing.event_id !== eventId ||
            commandRow.version !== 3 || command.status !== "succeeded" ||
            !command.resultSnapshot ||
            command.resultSnapshot.controlVersion !== existing.control_version ||
            !outbox || outbox.command_id !== command.commandId ||
            outbox.run_id !== command.runId ||
            outbox.id !== command.commandId + ":remote-receipt-terminal" ||
            outbox.event_id !== eventId ||
            outboxRecord?.id !== outbox.id ||
            outboxRecord.eventId !== eventId ||
            outboxRecord.commandId !== command.commandId ||
            outboxRecord.runId !== command.runId ||
            outboxRecord.kind !== "audit" ||
            outboxEvidence?.operation !== command.operation ||
            outboxEvidence.outcome !== "applied" ||
            outboxEvidence.receiptId !== receipt.receiptId ||
            outboxEvidence.providerId !== input.providerId ||
            !control || control.version !== existing.control_version ||
            controlPayload?.causedByCommandId !== command.commandId) deny("replay_inconsistent");
        this.db.exec("COMMIT;");
        return { action: "replayed_terminal", commandVersion: 3,
          controlVersion: existing.control_version, eventId };
      }

      if (effect.status !== "unknown" ||
          commandRow.version !== 2 || command.status !== "executing") deny("stale_terminal_claim");
      const local = this.db.prepare(
        "SELECT effect_id FROM recovery_effect_sink_receipts WHERE idempotency_key=?"
      ).get(intent.idempotencyKey);
      if (local) deny("mixed_sink_evidence");

      const before = registry.getCurrentProfileRevision(input.providerId);
      const audit = reviewRecoveryProviderConformance(registry, {
        providerId: input.providerId, operation: "reconcile_unknown_applied",
        effectStatus: "unknown", recoveryWindowSeconds: input.recoveryWindowSeconds
      }, input.nowEpochMs, input.maxProbeAgeMs);
      const after = registry.getCurrentProfileRevision(input.providerId);
      if (!audit.candidate || !Number.isSafeInteger(before) ||
          before !== after || receipt.profileRevision !== before) deny("provider_conformance");

      const checkpointRow = this.db.prepare(
        "SELECT version,payload FROM agent_checkpoints WHERE run_id=?"
      ).get(intent.command.runId) as { version: number; payload: string } | undefined;
      if (!checkpointRow ||
          checkpointRow.version !== intent.command.expectedCheckpointVersion) deny("checkpoint_cas");
      const checkpoint = JSON.parse(checkpointRow.payload) as AgentRunCheckpoint;
      const controlRow = this.db.prepare(
        "SELECT version,payload FROM recovery_controls WHERE run_id=?"
      ).get(intent.command.runId) as DbControl | undefined;
      if ((controlRow?.version ?? 0) !== plan.expectedControlVersion) deny("control_cas");
      const oldControl = controlRow
        ? JSON.parse(controlRow.payload) as RecoveryControlState : undefined;
      const prepared = prepareControlOnlyRecovery({
        command: intent.command, checkpoint, control: oldControl,
        authorization: { allowed: true, reason: "same_sqlite_authorized" },
        timestamp: input.timestamp
      });
      if (prepared.outcome !== "applied" ||
          prepared.writeSet.control !== "cas_update" ||
          prepared.writeSet.checkpoint !== "compare") deny("not_applicable");

      const nextControl: RecoveryControlState = {
        ...prepared.control, version: plan.expectedControlVersion + 1,
        updatedAt: input.timestamp
      };
      const snapshot = {
        status: prepared.status, reason: prepared.reason,
        checkpointVersion: checkpointRow.version,
        controlVersion: nextControl.version
      };
      const nextCommand: DurableRecoveryCommandRecord = {
        ...command, status: "succeeded", version: 3,
        updatedAt: input.timestamp, resultReason: prepared.reason,
        resultSnapshot: snapshot
      };
      // A test-only fault here must roll back ALL subsequent writes.
      this.db.prepare(
        "INSERT INTO recovery_remote_receipt_consumptions (effect_id,provider_id,receipt_id,command_id,event_id,control_version) VALUES (?,?,?,?,?,?)"
      ).run(intent.effectId, input.providerId, receipt.receiptId,
        command.commandId, eventId, nextControl.version);
      this.afterConsumptionWrite?.();

      const controlWrite = controlRow
        ? this.db.prepare(
            "UPDATE recovery_controls SET version=?,payload=?,updated_at=? WHERE run_id=? AND version=?"
          ).run(nextControl.version, JSON.stringify(nextControl), input.timestamp,
            command.runId, plan.expectedControlVersion)
        : this.db.prepare(
            "INSERT INTO recovery_controls (run_id,version,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(run_id) DO NOTHING"
          ).run(command.runId, nextControl.version, JSON.stringify(nextControl), input.timestamp);
      if (controlWrite.changes !== 1) deny("control_write_conflict");
      const commandWrite = this.db.prepare(
        "UPDATE recovery_commands SET version=3,payload=?,updated_at=? WHERE command_id=? AND version=2 AND json_extract(payload,'$.status')='executing'"
      ).run(JSON.stringify(nextCommand), input.timestamp, command.commandId);
      if (commandWrite.changes !== 1) deny("command_write_conflict");
      const outboxId = command.commandId + ":remote-receipt-terminal";
      const event = {
        id: outboxId, eventId, commandId: command.commandId, runId: command.runId,
        kind: "audit", payload: JSON.stringify({
          operation: command.operation, outcome: "applied",
          receiptId: receipt.receiptId, providerId: input.providerId
        }), status: "pending", attempts: 0, version: 1,
        createdAt: input.timestamp, updatedAt: input.timestamp
      };
      const outboxWrite = this.db.prepare(
        "INSERT INTO recovery_outbox (id,event_id,command_id,run_id,payload,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING"
      ).run(outboxId, eventId, command.commandId, command.runId,
        JSON.stringify(event), input.timestamp);
      if (outboxWrite.changes !== 1) deny("outbox_conflict");
      const effectWrite = this.db.prepare(
        "UPDATE recovery_effect_intents SET status='committed' WHERE effect_id=? AND status='unknown' AND epoch=?"
      ).run(intent.effectId, fence.epoch);
      if (effectWrite.changes !== 1) deny("effect_cas");
      if (registry.getCurrentProfileRevision(input.providerId) !== before) deny("provider_drift");
      this.db.exec("COMMIT;");
      return { action: "committed", commandVersion: 3,
        controlVersion: nextControl.version, eventId };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      if (error instanceof RemoteReceiptFinalizationConflict) throw error;
      throw new RemoteReceiptFinalizationConflict("transaction_or_authority_failure");
    }
  }

  inspectConsumption(effectId: string): DbConsumption | undefined {
    return this.db.prepare(
      "SELECT * FROM recovery_remote_receipt_consumptions WHERE effect_id=?"
    ).get(effectId) as DbConsumption | undefined;
  }
}
