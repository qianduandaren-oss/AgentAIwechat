import { DatabaseSync } from "node:sqlite";
import type { AgentRunCheckpoint } from "./checkpoint.js";
import type { DurableRecoveryCommandRecord } from "./recovery-command-store.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import type { RecoveryControlState } from "./recovery-operations.js";
import {
  SQLITE_CHECKPOINT_PRAGMAS,
  SQLITE_CHECKPOINT_SCHEMA
} from "./sqlite-checkpoint-sql.js";

const SCHEMA = `
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
}

export class SQLiteRecoveryFinalizationUnitOfWork {
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
    this.db.exec(SCHEMA);
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
      const checkpoint = {
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

      const control = {
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
