import { DatabaseSync } from "node:sqlite";
import {
  assertRecoveryExternalEffectFenceBinding,
  RecoveryExternalEffectFenceConflictError,
  type RecoveryExternalEffectFence,
  type RecoveryExternalEffectIntent
} from "./recovery-external-effect-fence.js";
import {
  assertRecoveryAuthorizationEvidence,
  assertRecoveryAuthorizationRevisionsUnchanged
} from "./recovery-authorization-evidence.js";
import type { DurableRecoveryCommandRecord } from "./recovery-command-store.js";

/**
 * Day 70 NOON: same-SQLite *candidate* effect ledger and simulated sink.
 *
 * This is not a third-party provider. In production an external sink must
 * enforce the latest epoch and the idempotency key in ITS atomic effect write.
 * This module must never be wired to a non-fencing provider as proof of
 * exactly-once execution.
 */
export type RecoveryEffectLedgerStatus =
  "pending" | "leased" | "unknown" | "committed";

type LedgerRow = {
  effect_id: string;
  idempotency_key: string;
  intent_json: string;
  status: RecoveryEffectLedgerStatus;
  epoch: number;
  dispatcher_id: string | null;
};
type RunAuthorityRow = {
  tenant_id: string;
  tenant_revision: number;
  acl_revision: number;
};
type GrantRow = { grant_revision: number; allowed: number };
type PermissionRow = { allowed: number };
type ReceiptRow = { effect_id: string; applied_epoch: number };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS recovery_effect_intents (",
  " effect_id TEXT PRIMARY KEY,",
  " idempotency_key TEXT NOT NULL UNIQUE,",
  " intent_json TEXT NOT NULL,",
  " status TEXT NOT NULL CHECK(status IN ('pending','leased','unknown','committed')),",
  " epoch INTEGER NOT NULL DEFAULT 0,",
  " dispatcher_id TEXT",
  ");",
  "CREATE TABLE IF NOT EXISTS recovery_effect_sink_receipts (",
  " idempotency_key TEXT PRIMARY KEY,",
  " effect_id TEXT NOT NULL UNIQUE,",
  " applied_epoch INTEGER NOT NULL",
  ");"
].join("\n");

export class RecoveryEffectLedgerConflictError extends Error {
  constructor() {
    super("External effect intent, authority, epoch or state is invalid");
    this.name = "RecoveryEffectLedgerConflictError";
  }
}

export type RecoveryEffectDispatchClaim =
  | { action: "claimed"; fence: RecoveryExternalEffectFence }
  | { action: "in_flight" | "reconcile_required" | "already_committed" };

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 256;
}

export class SQLiteRecoveryExternalEffectLedger {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private load(effectId: string): LedgerRow | undefined {
    return this.db.prepare(
      "SELECT * FROM recovery_effect_intents WHERE effect_id = ?"
    ).get(effectId) as LedgerRow | undefined;
  }

  private require(effectId: string): LedgerRow {
    const record = this.load(effectId);
    if (!record) throw new RecoveryEffectLedgerConflictError();
    return record;
  }

  private savedIntent(row: LedgerRow): RecoveryExternalEffectIntent {
    return JSON.parse(row.intent_json) as RecoveryExternalEffectIntent;
  }

  private sameIntent(row: LedgerRow, intent: RecoveryExternalEffectIntent): void {
    // Candidate ledger freezes the complete server-created intent identity.
    if (JSON.stringify(this.savedIntent(row)) !== JSON.stringify(intent) ||
        row.idempotency_key !== intent.idempotencyKey) {
      throw new RecoveryEffectLedgerConflictError();
    }
  }

  /** Validate trusted same-file Command and current ACL before any effect. */
  private assertCurrentAuthority(intent: RecoveryExternalEffectIntent): void {
    try {
      assertRecoveryAuthorizationEvidence(
        intent.command,
        {
          actorId: intent.authorizationEvidence.actorId,
          tenantId: intent.authorizationEvidence.tenantId
        },
        intent.authorizationEvidence
      );
    } catch {
      throw new RecoveryEffectLedgerConflictError();
    }
    if (!nonempty(intent.effectId) || !nonempty(intent.idempotencyKey) ||
        (intent.owner !== "atomic_control_only" && intent.owner !== "legacy")) {
      throw new RecoveryEffectLedgerConflictError();
    }
    const commandRow = this.db.prepare(
      "SELECT payload FROM recovery_commands WHERE command_id = ?"
    ).get(intent.command.commandId) as { payload: string } | undefined;
    const command = commandRow
      ? JSON.parse(commandRow.payload) as DurableRecoveryCommandRecord
      : undefined;
    if (!command || command.status !== "executing" ||
        command.version !== 2 ||
        command.authorizationFence !== "same_sqlite" ||
        command.executionOwner !== intent.owner ||
        command.runId !== intent.command.runId ||
        command.operation !== intent.command.operation ||
        command.requestedBy !== intent.command.requestedBy ||
        command.reason !== intent.command.reason ||
        command.expectedCheckpointVersion !== intent.command.expectedCheckpointVersion ||
        command.expectedControlVersion !== intent.command.expectedControlVersion) {
      throw new RecoveryEffectLedgerConflictError();
    }
    const run = this.db.prepare(
      "SELECT tenant_id, tenant_revision, acl_revision FROM recovery_authority_runs WHERE run_id = ?"
    ).get(intent.command.runId) as RunAuthorityRow | undefined;
    const grant = this.db.prepare(
      "SELECT grant_revision, allowed FROM recovery_authority_actor_grants WHERE actor_id = ? AND tenant_id = ? AND operation = ?"
    ).get(
      intent.authorizationEvidence.actorId,
      intent.authorizationEvidence.tenantId,
      intent.command.operation
    ) as GrantRow | undefined;
    const permission = this.db.prepare(
      "SELECT allowed FROM recovery_authority_run_permissions WHERE run_id = ? AND actor_id = ? AND operation = ?"
    ).get(
      intent.command.runId,
      intent.authorizationEvidence.actorId,
      intent.command.operation
    ) as PermissionRow | undefined;
    if (!run || run.tenant_id !== intent.authorizationEvidence.tenantId ||
        !grant || grant.allowed !== 1 ||
        !permission || permission.allowed !== 1) {
      throw new RecoveryEffectLedgerConflictError();
    }
    try {
      assertRecoveryAuthorizationRevisionsUnchanged(
        intent.authorizationEvidence.revisions,
        {
          runTenantRevision: run.tenant_revision,
          runAclRevision: run.acl_revision,
          actorGrantRevision: grant.grant_revision
        }
      );
    } catch {
      throw new RecoveryEffectLedgerConflictError();
    }
  }

  /**
   * Persist the immutable intent before dispatch. No external effect here.
   * A duplicate key for another effect is rejected by SQLite's UNIQUE index.
   */
  stageIntent(intent: RecoveryExternalEffectIntent): RecoveryEffectLedgerStatus {
    return this.transaction(() => {
      this.assertCurrentAuthority(intent);
      const old = this.load(intent.effectId);
      if (old) {
        this.sameIntent(old, intent);
        return old.status;
      }
      try {
        this.db.prepare(
          "INSERT INTO recovery_effect_intents (effect_id,idempotency_key,intent_json,status,epoch) VALUES (?,?,?,'pending',0)"
        ).run(intent.effectId, intent.idempotencyKey, JSON.stringify(intent));
      } catch {
        throw new RecoveryEffectLedgerConflictError();
      }
      return "pending";
    });
  }

  /**
   * A short transaction leases a pending intent and increments its epoch.
   * Existing leases and UNKNOWN results never silently reacquire.
   */
  claimDispatch(effectId: string, dispatcherId: string): RecoveryEffectDispatchClaim {
    if (!nonempty(dispatcherId)) throw new RecoveryEffectLedgerConflictError();
    return this.transaction(() => {
      const row = this.require(effectId);
      if (row.status === "leased") return { action: "in_flight" };
      if (row.status === "unknown") return { action: "reconcile_required" };
      if (row.status === "committed") return { action: "already_committed" };
      const intent = this.savedIntent(row);
      this.assertCurrentAuthority(intent);
      if (!Number.isSafeInteger(row.epoch) ||
          row.epoch < 0 || row.epoch === Number.MAX_SAFE_INTEGER) {
        throw new RecoveryEffectLedgerConflictError();
      }
      const epoch = row.epoch + 1;
      const changes = this.db.prepare(
        "UPDATE recovery_effect_intents SET status = 'leased',epoch = ?,dispatcher_id = ? WHERE effect_id = ? AND status = 'pending' AND epoch = ?"
      ).run(epoch, dispatcherId, effectId, row.epoch).changes;
      if (changes !== 1) throw new RecoveryEffectLedgerConflictError();
      return {
        action: "claimed",
        fence: {
          commandId: intent.command.commandId,
          runId: intent.command.runId,
          actorId: intent.command.requestedBy,
          tenantId: intent.authorizationEvidence.tenantId,
          owner: intent.owner,
          effectId: intent.effectId,
          idempotencyKey: intent.idempotencyKey,
          epoch,
          authorizationRevisions: structuredClone(intent.authorizationEvidence.revisions)
        }
      };
    });
  }

  /**
   * Simulated sink ONLY: latest-epoch validation and durable deduplication are
   * in the SAME transaction as inserting the mock side-effect receipt.
   * For an actual HTTP provider, this guarantee does NOT extend over network.
   */
  dispatchToSameSQLiteSink(
    intent: RecoveryExternalEffectIntent,
    fence: RecoveryExternalEffectFence
  ): "committed" | "already_applied" {
    assertRecoveryExternalEffectFenceBinding(intent, fence);
    return this.transaction(() => {
      const row = this.require(intent.effectId);
      this.sameIntent(row, intent);
      if (row.status !== "leased" || row.epoch !== fence.epoch) {
        throw new RecoveryExternalEffectFenceConflictError();
      }
      this.assertCurrentAuthority(intent);
      const receipt = this.db.prepare(
        "SELECT effect_id,applied_epoch FROM recovery_effect_sink_receipts WHERE idempotency_key = ?"
      ).get(intent.idempotencyKey) as ReceiptRow | undefined;
      if (receipt) {
        if (receipt.effect_id !== intent.effectId) {
          throw new RecoveryEffectLedgerConflictError();
        }
        return "already_applied";
      }
      this.db.prepare(
        "INSERT INTO recovery_effect_sink_receipts (idempotency_key,effect_id,applied_epoch) VALUES (?,?,?)"
      ).run(intent.idempotencyKey, intent.effectId, fence.epoch);
      return "committed";
    });
  }

  /** Only record success when a receipt can be verified in this simulation. */
  confirmApplied(intent: RecoveryExternalEffectIntent, fence: RecoveryExternalEffectFence): void {
    assertRecoveryExternalEffectFenceBinding(intent, fence);
    this.transaction(() => {
      const row = this.require(intent.effectId);
      this.sameIntent(row, intent);
      const receipt = this.db.prepare(
        "SELECT effect_id FROM recovery_effect_sink_receipts WHERE idempotency_key = ?"
      ).get(intent.idempotencyKey) as { effect_id: string } | undefined;
      if (row.epoch !== fence.epoch ||
          !["leased", "unknown", "committed"].includes(row.status) ||
          receipt?.effect_id !== intent.effectId) {
        throw new RecoveryEffectLedgerConflictError();
      }
      this.db.prepare(
        "UPDATE recovery_effect_intents SET status = 'committed' WHERE effect_id = ?"
      ).run(intent.effectId);
    });
  }

  /** After a response timeout, never pretend that the effect failed. */
  markUnknown(effectId: string, epoch: number): void {
    this.transaction(() => {
      const row = this.require(effectId);
      if (row.epoch !== epoch || row.status !== "leased") {
        throw new RecoveryEffectLedgerConflictError();
      }
      this.db.prepare(
        "UPDATE recovery_effect_intents SET status = 'unknown' WHERE effect_id = ?"
      ).run(effectId);
    });
  }

  /**
   * LOCAL-SINK-ONLY reconciliation: receipt and latest epoch share one DB.
   * No receipt means the local sink has not committed; UNKNOWN -> pending,
   * and the next claim increments the epoch so the old worker is rejected.
   * NEVER equate a missing remote provider receipt with "not applied".
   */
  reconcileAgainstSameSQLiteSink(effectId: string): "committed" | "ready_for_new_epoch" {
    return this.transaction(() => {
      const row = this.require(effectId);
      if (row.status !== "unknown") {
        throw new RecoveryEffectLedgerConflictError();
      }
      const receipt = this.db.prepare(
        "SELECT effect_id FROM recovery_effect_sink_receipts WHERE idempotency_key = ?"
      ).get(row.idempotency_key) as { effect_id: string } | undefined;
      if (receipt && receipt.effect_id !== effectId) {
        throw new RecoveryEffectLedgerConflictError();
      }
      const status = receipt ? "committed" : "pending";
      this.db.prepare(
        "UPDATE recovery_effect_intents SET status = ? WHERE effect_id = ?"
      ).run(status, effectId);
      return receipt ? "committed" : "ready_for_new_epoch";
    });
  }

  inspect(effectId: string): { status: RecoveryEffectLedgerStatus; epoch: number } | undefined {
    const row = this.load(effectId);
    return row ? { status: row.status, epoch: row.epoch } : undefined;
  }

  countSimulatedEffects(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS total FROM recovery_effect_sink_receipts"
    ).get() as { total: number };
    return row.total;
  }
}
