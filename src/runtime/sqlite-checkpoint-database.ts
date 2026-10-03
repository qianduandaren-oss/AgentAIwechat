import { DatabaseSync } from "node:sqlite";
import {
  SQLITE_CHECKPOINT_PRAGMAS,
  SQLITE_CHECKPOINT_SCHEMA,
  SQLITE_INSERT_CHECKPOINT_IF_ABSENT,
  SQLITE_SELECT_CHECKPOINT,
  SQLITE_UPDATE_CHECKPOINT_IF_VERSION
} from "./sqlite-checkpoint-sql.js";
import type {
  CheckpointRow,
  TransactionalCheckpointDatabase
} from "./transactional-checkpoint-store.js";

interface SQLiteCheckpointRow {
  run_id: string;
  version: number;
  payload: string;
  updated_at: string;
}

export class SQLiteTransactionalCheckpointDatabase
  implements TransactionalCheckpointDatabase {

  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);

    for (const pragma of SQLITE_CHECKPOINT_PRAGMAS) {
      this.database.exec(pragma);
    }

    this.database.exec(SQLITE_CHECKPOINT_SCHEMA);
  }

  async load(runId: string): Promise<CheckpointRow | undefined> {
    const statement = this.database.prepare(SQLITE_SELECT_CHECKPOINT);
    const row = statement.get(runId) as SQLiteCheckpointRow | undefined;

    if (!row) return undefined;

    return {
      runId: row.run_id,
      version: row.version,
      payload: row.payload,
      updatedAt: row.updated_at
    };
  }

  async insertIfAbsent(row: CheckpointRow): Promise<boolean> {
    const result = this.database
      .prepare(SQLITE_INSERT_CHECKPOINT_IF_ABSENT)
      .run(row.runId, row.version, row.payload, row.updatedAt);

    return Number(result.changes) === 1;
  }

  async updateIfVersion(
    row: CheckpointRow,
    expectedVersion: number
  ): Promise<boolean> {
    const result = this.database
      .prepare(SQLITE_UPDATE_CHECKPOINT_IF_VERSION)
      .run(
        row.version,
        row.payload,
        row.updatedAt,
        row.runId,
        expectedVersion
      );

    return Number(result.changes) === 1;
  }

  close(): void {
    this.database.close();
  }
}
