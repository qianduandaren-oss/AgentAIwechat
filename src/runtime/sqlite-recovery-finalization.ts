import { DatabaseSync } from "node:sqlite";
import type { AgentRunCheckpoint } from "./checkpoint.js";
import {
  RecoveryCommandConflictError,
  type DurableRecoveryCommandRecord,
  type RecoveryCommandStore
} from "./recovery-command-store.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import type { RecoveryControlState } from "./recovery-operations.js";
import type { RecoveryWriteSet } from "./recovery-write-set.js";
import {
  decideDurableRecoveryOperation,
  type DurableRecoveryOperationCommand
} from "./durable-recovery-operation-orchestrator.js";
import {
  RecoverySharedOwnershipConflictError,
  type RecoveryClaimOwner,
  type SharedRecoveryOwnershipClaim,
  type SharedRecoveryOwnershipClaimer
} from "./recovery-shared-ownership-claim.js";
import {
  assertRecoveryAuthorizationEvidence,
  assertRecoveryAuthorizationRevisionsUnchanged,
  RecoveryAuthorizationEvidenceConflictError,
  type RecoveryAuthorizationEvidence,
  type TransactionalAuthorizedRecoveryClaimer
} from "./recovery-authorization-evidence.js";
import { RecoveryTerminalSnapshotMissingError } from "./recovery-atomic-route-decision.js";
import {
  selectAtomicRecoveryRoute,
  type AtomicRecoveryRouteDecision
} from "./recovery-atomic-route-decision.js";
import {
  SQLITE_CHECKPOINT_PRAGMAS,
  SQLITE_CHECKPOINT_SCHEMA
} from "./sqlite-checkpoint-sql.js";

export const RECOVERY_FINALIZATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_controls (
  run_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_commands (
  command_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export class RecoveryFinalizationConflictError extends Error {
  constructor(public readonly entity: string) {
    super(`Recovery finalization conflict: ${entity}`);
    this.name = "RecoveryFinalizationConflictError";
  }
}

export interface RecoveryFinalizationInput {
  checkpoint: AgentRunCheckpoint;
  expectedCheckpointVersion: number;
  control: RecoveryControlState;
  expectedControlVersion: number;
  command: DurableRecoveryCommandRecord;
  expectedCommandVersion: number;
  outbox: RecoveryOutboxRecord[];
  /** Omission preserves the original dual-update contract. */
  writeSet?: RecoveryWriteSet;
}

/**
 * Consistent, read-only facts for operator investigation after a crash.
 * This is NOT permission to retry a command or infer that an effect ran.
 */
export interface RecoveryInFlightEvidence {
  command?: DurableRecoveryCommandRecord;
  checkpoint?: AgentRunCheckpoint;
  control?: RecoveryControlState;
  outboxEventIds: string[];
}

/**
 * Day 69 candidate SAME-SQLite authorization authority for reproducible
 * transaction tests. These rows must be maintained by a trusted ACL writer;
 * they are NOT synced to an external identity service or a production IdP.
 */
export const RECOVERY_AUTHORIZATION_AUTHORITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_authority_runs (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tenant_revision INTEGER NOT NULL,
  acl_revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_authority_actor_grants (
  actor_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  grant_revision INTEGER NOT NULL,
  allowed INTEGER NOT NULL,
  PRIMARY KEY (actor_id, tenant_id, operation)
);
CREATE TABLE IF NOT EXISTS recovery_authority_run_permissions (
  run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  PRIMARY KEY (run_id, actor_id, operation)
);
`;

export class SQLiteRecoveryFinalizationUnitOfWork implements TransactionalAuthorizedRecoveryClaimer, SharedRecoveryOwnershipClaimer {
  private readonly db: DatabaseSync;

  constructor(
    filePath: string,
    private readonly now: () => string =
      () => new Date().toISOString()
  ) {
    this.db = new DatabaseSync(filePath);
    for (const pragma of SQLITE_CHECKPOINT_PRAGMAS) {
      this.db.exec(pragma);
    }
    this.db.exec(SQLITE_CHECKPOINT_SCHEMA);
    this.db.exec(RECOVERY_FINALIZATION_SCHEMA);
    this.db.exec(RECOVERY_AUTHORIZATION_AUTHORITY_SCHEMA);
  }


  /**
   * Day 67 shared transactional Claim, used by BOTH candidate owners.
   * Unlike the old preflight guard, lookup + owner check + CAS are one
   * BEGIN IMMEDIATE transaction. Nothing is executed while SQLite is locked.
   */
  async claim(
    request: DurableRecoveryOperationCommand,
    owner: RecoveryClaimOwner,
    evidence?: RecoveryAuthorizationEvidence
  ): Promise<SharedRecoveryOwnershipClaim> {
    if (!request.commandId.trim() ||
        !request.runId.trim() ||
        !request.requestedBy.trim()) {
      throw new Error("Shared recovery claim requires nonempty identity");
    }
    if (owner === "atomic_control_only" &&
        !["quarantine", "release_quarantine", "dead_letter"].includes(request.operation)) {
      throw new Error("Atomic ownership only supports Control-only operations");
    }
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      if (evidence) this.assertAuthorizedEvidenceInTransaction(request, evidence);
      const existing = this.loadCommand(request.commandId);
      const decision = decideDurableRecoveryOperation(existing, request);
      if (existing) {
        if (existing.executionOwner !== owner) {
          throw new RecoverySharedOwnershipConflictError(
            request.commandId, owner, existing.executionOwner
          );
        }
        if (decision.action === "replay_terminal") {
          if (!decision.record.resultSnapshot) {
            throw new RecoveryTerminalSnapshotMissingError(request.commandId);
          }
          const result: SharedRecoveryOwnershipClaim = {
            action: "replayed_terminal",
            owner, record: decision.record,
            resultSnapshot: structuredClone(decision.record.resultSnapshot)
          };
          this.db.exec("COMMIT;");
          return result;
        }
        const result: SharedRecoveryOwnershipClaim = {
          action: "suspend_in_flight", owner,
          record: structuredClone(existing)
        };
        this.db.exec("COMMIT;");
        return result;
      }

      const timestamp = this.now();
      const accepted: DurableRecoveryCommandRecord = {
        commandId: request.commandId,
        runId: request.runId,
        operation: request.operation,
        requestedBy: request.requestedBy,
        reason: request.reason,
        expectedCheckpointVersion: request.expectedCheckpointVersion,
        expectedControlVersion: request.expectedControlVersion,
        executionOwner: owner,
        status: "accepted",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const insert = this.db.prepare(`
        INSERT INTO recovery_commands (command_id, version, payload, updated_at)
        VALUES (?, 1, ?, ?) ON CONFLICT(command_id) DO NOTHING;
      `).run(accepted.commandId, JSON.stringify(accepted), timestamp);
      this.mustWrite(insert.changes, "shared_claim_insert");
      const executing: DurableRecoveryCommandRecord = {
        ...accepted, status: "executing", version: 2
      };
      const cas = this.db.prepare(`
        UPDATE recovery_commands SET version = 2, payload = ?, updated_at = ?
        WHERE command_id = ? AND version = 1
          AND json_extract(payload, '$.status') = 'accepted'
          AND json_extract(payload, '$.executionOwner') = ?;
      `).run(
        JSON.stringify(executing), timestamp, request.commandId, owner
      );
      this.mustWrite(cas.changes, "shared_claim_cas");
      this.db.exec("COMMIT;");
      return { action: "claimed_executing", owner, record: structuredClone(executing) };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  /**
   * Day 69 noon: permission/tenant revision check and durable Command Claim
   * share ONE BEGIN IMMEDIATE on the same SQLite file.
   *
   * This is a candidate local ACL authority, not an adapter for external ACL.
   * Do not expose raw claim() or claimAuthorized() to untrusted callers.
   */
  async claimAuthorized(
    request: DurableRecoveryOperationCommand,
    owner: RecoveryClaimOwner,
    evidence: RecoveryAuthorizationEvidence
  ): Promise<SharedRecoveryOwnershipClaim> {
    if (!evidence) throw new RecoveryAuthorizationEvidenceConflictError();
    return this.claim(request, owner, evidence);
  }

  private assertAuthorizedEvidenceInTransaction(
    request: DurableRecoveryOperationCommand,
    evidence: RecoveryAuthorizationEvidence
  ): void {
    // The authenticated principal must have been verified upstream.
    // This binding check does NOT authenticate request.requestedBy.
    assertRecoveryAuthorizationEvidence(
      request,
      { actorId: request.requestedBy, tenantId: evidence.tenantId },
      evidence
    );
    const run = this.db.prepare(`
      SELECT tenant_id, tenant_revision, acl_revision
      FROM recovery_authority_runs WHERE run_id = ?;
    `).get(request.runId) as {
      tenant_id: string; tenant_revision: number; acl_revision: number
    } | undefined;
    if (!run || run.tenant_id !== evidence.tenantId) {
      throw new RecoveryAuthorizationEvidenceConflictError();
    }
    const actor = this.db.prepare(`
      SELECT grant_revision, allowed FROM recovery_authority_actor_grants
      WHERE actor_id = ? AND tenant_id = ? AND operation = ?;
    `).get(evidence.actorId, run.tenant_id, request.operation) as {
      grant_revision: number; allowed: number
    } | undefined;
    const resource = this.db.prepare(`
      SELECT allowed FROM recovery_authority_run_permissions
      WHERE run_id = ? AND actor_id = ? AND operation = ?;
    `).get(request.runId, evidence.actorId, request.operation) as {
      allowed: number
    } | undefined;
    if (!actor || actor.allowed !== 1 || !resource || resource.allowed !== 1) {
      throw new RecoveryAuthorizationEvidenceConflictError();
    }
    assertRecoveryAuthorizationRevisionsUnchanged(evidence.revisions, {
      runTenantRevision: run.tenant_revision,
      runAclRevision: run.acl_revision,
      actorGrantRevision: actor.grant_revision
    });
  }

  /**
   * Candidate legacy bridge to the SAME recovery_commands table.
   * Used only with claim-aware Orchestrator; no independent Map/DB authority.
   */
  asLegacyCommandStore(): RecoveryCommandStore {
    return {
      load: async commandId => this.loadCommand(commandId),
      insertIfAbsent: async record => {
        if (record.executionOwner !== "legacy") {
          throw new RecoverySharedOwnershipConflictError(
            record.commandId, "legacy", record.executionOwner
          );
        }
        return this.insertCommandIfAbsent(record);
      },
      updateIfVersion: async (record, expectedVersion) =>
        this.updateLegacyCommandIfVersion(record, expectedVersion)
    };
  }

  private updateLegacyCommandIfVersion(
    proposed: DurableRecoveryCommandRecord,
    expectedVersion: number
  ): DurableRecoveryCommandRecord {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const previous = this.loadCommand(proposed.commandId);
      const actual = previous?.version ?? 0;
      if (!previous || actual !== expectedVersion) {
        throw new RecoveryCommandConflictError(
          proposed.commandId, expectedVersion, actual
        );
      }
      if (previous.executionOwner !== "legacy" ||
          proposed.executionOwner !== "legacy") {
        throw new RecoverySharedOwnershipConflictError(
          proposed.commandId, "legacy", previous.executionOwner
        );
      }
      decideDurableRecoveryOperation(previous, proposed);
      const transition =
        (previous.status === "accepted" && proposed.status === "executing") ||
        (previous.status === "executing" &&
          ["succeeded", "rejected", "failed"].includes(proposed.status));
      if (!transition) {
        throw new RecoveryFinalizationConflictError("legacy_command_transition");
      }
      const saved = {
        ...structuredClone(proposed), version: actual + 1
      };
      const write = this.db.prepare(`
        UPDATE recovery_commands
        SET version = ?, payload = ?, updated_at = ?
        WHERE command_id = ? AND version = ?
          AND json_extract(payload, '$.executionOwner') = 'legacy';
      `).run(
        saved.version, JSON.stringify(saved), saved.updatedAt,
        saved.commandId, expectedVersion
      );
      this.mustWrite(write.changes, "legacy_terminal_cas");
      this.db.exec("COMMIT;");
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  /**
   * Day 65: Admission and accepted -> executing CAS share THIS SQLite file.
   * No legacy executor is invoked; a repeated command is never re-claimed.
   * This is an opt-in building block, NOT a production route switch.
   */
  admitControlOnlyCommand(
    request: DurableRecoveryOperationCommand
  ): AtomicRecoveryRouteDecision | {
    action: "admitted_executing";
    record: DurableRecoveryCommandRecord;
  } {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.loadCommand(request.commandId);
      const decision = selectAtomicRecoveryRoute({
        atomicControlOnlyEnabled: true,
        command: request,
        existing
      });
      if (decision.action !== "admit_new_control_only") {
        this.db.exec("COMMIT;");
        return decision;
      }

      const timestamp = this.now();
      const accepted: DurableRecoveryCommandRecord = {
        commandId: request.commandId,
        runId: request.runId,
        operation: request.operation,
        requestedBy: request.requestedBy,
        reason: request.reason,
        expectedCheckpointVersion: request.expectedCheckpointVersion,
        expectedControlVersion: request.expectedControlVersion,
        executionOwner: "atomic_control_only",
        status: "accepted",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const insert = this.db.prepare(`
        INSERT INTO recovery_commands (command_id, version, payload, updated_at)
        VALUES (?, 1, ?, ?) ON CONFLICT(command_id) DO NOTHING;
      `).run(
        accepted.commandId, JSON.stringify(accepted), timestamp
      );
      this.mustWrite(insert.changes, "admission_insert");

      const executing: DurableRecoveryCommandRecord = {
        ...accepted,
        status: "executing",
        version: 2
      };
      const claim = this.db.prepare(`
        UPDATE recovery_commands
        SET version = 2, payload = ?, updated_at = ?
        WHERE command_id = ? AND version = 1
          AND json_extract(payload, '$.status') = 'accepted';
      `).run(
        JSON.stringify(executing), timestamp, request.commandId
      );
      this.mustWrite(claim.changes, "admission_claim");
      this.db.exec("COMMIT;");
      return { action: "admitted_executing", record: structuredClone(executing) };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  insertCommandIfAbsent(
    command: DurableRecoveryCommandRecord
  ): boolean {
    const stored = {
      ...structuredClone(command),
      version: 1
    };
    const result = this.db.prepare(`
      INSERT INTO recovery_commands (
        command_id, version, payload, updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(command_id) DO NOTHING;
    `).run(
      stored.commandId,
      stored.version,
      JSON.stringify(stored),
      stored.updatedAt
    );
    return Number(result.changes) === 1;
  }

  commit(input: RecoveryFinalizationInput) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      // Legacy callers that omit writeSet continue to update both state rows.
      const writes = input.writeSet ?? {
        checkpoint: "cas_update",
        control: "cas_update",
        command: "terminal_cas",
        outbox: "append_prepared_events"
      } as RecoveryWriteSet;
      if (
        !["compare", "cas_update"].includes(writes.checkpoint) ||
        !["compare", "cas_update"].includes(writes.control) ||
        writes.command !== "terminal_cas" ||
        writes.outbox !== "append_prepared_events"
      ) {
        throw new RecoveryFinalizationConflictError("write_set");
      }
      if (
        input.checkpoint.runId !== input.command.runId ||
        input.control.runId !== input.command.runId
      ) {
        throw new RecoveryFinalizationConflictError("run_identity");
      }

      // Even compare-only state belongs to the transaction's Read Set.
      const checkpointRow = this.db.prepare(`
        SELECT version, payload
        FROM agent_checkpoints WHERE run_id = ?;
      `).get(input.checkpoint.runId) as
        { version: number; payload: string } | undefined;
      if (
        !checkpointRow ||
        Number(checkpointRow.version) !== input.expectedCheckpointVersion
      ) {
        throw new RecoveryFinalizationConflictError("checkpoint");
      }
      let checkpoint: AgentRunCheckpoint =
        JSON.parse(checkpointRow.payload) as AgentRunCheckpoint;

      if (writes.checkpoint === "cas_update") {
        checkpoint = {
          ...structuredClone(input.checkpoint),
          version: input.expectedCheckpointVersion + 1,
          updatedAt: this.now()
        };
        const checkpointWrite = this.db.prepare(`
          UPDATE agent_checkpoints
          SET version = ?, payload = ?, updated_at = ?
          WHERE run_id = ? AND version = ?;
        `).run(
          checkpoint.version,
          JSON.stringify(checkpoint),
          checkpoint.updatedAt,
          checkpoint.runId,
          input.expectedCheckpointVersion
        );
        this.mustWrite(checkpointWrite.changes, "checkpoint");
      }

      const controlRow = this.db.prepare(`
        SELECT version, payload
        FROM recovery_controls WHERE run_id = ?;
      `).get(input.control.runId) as
        { version: number; payload: string } | undefined;
      if (
        Number(controlRow?.version ?? 0) !== input.expectedControlVersion
      ) {
        throw new RecoveryFinalizationConflictError("control");
      }
      // With no stored Control row, v0 is a derived default, NOT an insert.
      let control: RecoveryControlState = controlRow
        ? JSON.parse(controlRow.payload) as RecoveryControlState
        : { ...structuredClone(input.control), version: 0 };

      if (writes.control === "cas_update") {
        control = {
          ...structuredClone(input.control),
          version: input.expectedControlVersion + 1,
          updatedAt: this.now()
        };
        const controlWrite =
          input.expectedControlVersion === 0
            ? this.db.prepare(`
                INSERT INTO recovery_controls (
                  run_id, version, payload, updated_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(run_id) DO NOTHING;
              `).run(
                control.runId,
                control.version,
                JSON.stringify(control),
                control.updatedAt
              )
            : this.db.prepare(`
                UPDATE recovery_controls
                SET version = ?, payload = ?, updated_at = ?
                WHERE run_id = ? AND version = ?;
              `).run(
                control.version,
                JSON.stringify(control),
                control.updatedAt,
                control.runId,
                input.expectedControlVersion
              );
        this.mustWrite(controlWrite.changes, "control");
      }

      // A matching version alone is not sufficient: a terminal draft must
      // match the immutable identity of an executing persisted command.
      const commandRow = this.db.prepare(`
        SELECT version, payload FROM recovery_commands WHERE command_id = ?;
      `).get(input.command.commandId) as
        { version: number; payload: string } | undefined;
      const persistedCommand = commandRow
        ? JSON.parse(commandRow.payload) as DurableRecoveryCommandRecord
        : undefined;
      const identityKeys = [
        "commandId", "runId", "operation", "requestedBy", "reason",
        "expectedCheckpointVersion", "expectedControlVersion"
      ] as const;

      if (
        !persistedCommand ||
        Number(commandRow?.version) !== input.expectedCommandVersion ||
        persistedCommand.status !== "executing" ||
        !identityKeys.every(
          key => persistedCommand[key] === input.command[key]
        ) ||
        persistedCommand.executionOwner !== input.command.executionOwner ||
        !["succeeded", "rejected", "failed"].includes(input.command.status)
      ) {
        throw new RecoveryFinalizationConflictError(
          "command_identity_or_status"
        );
      }
      if (
        input.outbox.some(event =>
          event.commandId !== input.command.commandId ||
          event.runId !== input.command.runId
        )
      ) {
        throw new RecoveryFinalizationConflictError("outbox_identity");
      }

      const command = {
        ...structuredClone(input.command),
        version: input.expectedCommandVersion + 1,
        updatedAt: this.now()
      };
      const commandWrite = this.db.prepare(`
        UPDATE recovery_commands
        SET version = ?, payload = ?, updated_at = ?
        WHERE command_id = ? AND version = ?;
      `).run(
        command.version,
        JSON.stringify(command),
        command.updatedAt,
        command.commandId,
        input.expectedCommandVersion
      );
      this.mustWrite(commandWrite.changes, "command");

      for (const event of input.outbox) {
        const write = this.db.prepare(`
          INSERT INTO recovery_outbox (
            id, event_id, command_id, run_id, payload, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING;
        `).run(
          event.id,
          event.eventId,
          event.commandId,
          event.runId,
          JSON.stringify({
            ...structuredClone(event),
            status: "pending",
            attempts: 0,
            version: 1
          }),
          event.createdAt
        );
        this.mustWrite(write.changes, "outbox");
      }

      this.db.exec("COMMIT;");
      return { checkpoint, control, command };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  /**
   * Day 65 evening: read Command, Checkpoint, Control and Outbox from ONE
   * SQLite read transaction. Never changes accepted/executing/terminal state.
   * The caller must still verify immutable request identity separately.
   * An executing command with no event is AMBIGUOUS, not safe to retry.
   */
  inspectInFlightEvidence(
    commandId: string,
    runId: string
  ): RecoveryInFlightEvidence {
    this.db.exec("BEGIN;");
    try {
      const command = this.loadCommand(commandId);
      if (command && command.runId !== runId) {
        throw new RecoveryFinalizationConflictError("evidence_run_identity");
      }
      const checkpoint = this.loadCheckpoint(runId);
      const control = this.loadControl(runId);
      // Existing Node SQLite typings expose get/run, not StatementSync.all.
      // A JSON aggregate also keeps the read inside the same snapshot.
      const eventRow = this.db.prepare(`
        SELECT json_group_array(event_id) AS events
        FROM (
          SELECT event_id FROM recovery_outbox
          WHERE command_id = ? ORDER BY event_id
        );
      `).get(commandId) as { events: string } | undefined;
      const result: RecoveryInFlightEvidence = {
        command,
        checkpoint,
        control,
        outboxEventIds: JSON.parse(eventRow?.events ?? "[]") as string[]
      };
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  loadCommand(
    commandId: string
  ): DurableRecoveryCommandRecord | undefined {
    const row = this.db.prepare(`
      SELECT payload
      FROM recovery_commands
      WHERE command_id = ?;
    `).get(commandId) as { payload: string } | undefined;
    return row
      ? JSON.parse(row.payload) as DurableRecoveryCommandRecord
      : undefined;
  }

  loadControl(
    runId: string
  ): RecoveryControlState | undefined {
    const row = this.db.prepare(`
      SELECT payload
      FROM recovery_controls
      WHERE run_id = ?;
    `).get(runId) as { payload: string } | undefined;
    return row
      ? JSON.parse(row.payload) as RecoveryControlState
      : undefined;
  }

  loadCheckpoint(
    runId: string
  ): AgentRunCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT payload
      FROM agent_checkpoints
      WHERE run_id = ?;
    `).get(runId) as { payload: string } | undefined;
    return row
      ? JSON.parse(row.payload) as AgentRunCheckpoint
      : undefined;
  }

  countOutbox(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM recovery_outbox;"
    ).get() as { count: number };
    return Number(row.count);
  }

  close(): void {
    this.db.close();
  }

  private mustWrite(
    changes: number | bigint,
    entity: string
  ): void {
    if (Number(changes) !== 1) {
      throw new RecoveryFinalizationConflictError(entity);
    }
  }
}
