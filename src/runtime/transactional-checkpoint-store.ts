import type { AgentRunCheckpoint } from "./checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "./checkpoint-store.js";

export interface CheckpointRow {
  runId: string;
  version: number;
  payload: string;
  updatedAt: string;
}

/**
 * Storage-specific implementations must make insertIfAbsent and
 * updateIfVersion atomic in the shared persistence layer.
 *
 * PostgreSQL example:
 *
 * UPDATE agent_checkpoints
 * SET version = $1, payload = $2, updated_at = $3
 * WHERE run_id = $4 AND version = $5;
 */
export interface TransactionalCheckpointDatabase {
  load(
    runId: string
  ): Promise<CheckpointRow | undefined>;

  insertIfAbsent(
    row: CheckpointRow
  ): Promise<boolean>;

  updateIfVersion(
    row: CheckpointRow,
    expectedVersion: number
  ): Promise<boolean>;
}

function serialize(
  checkpoint: AgentRunCheckpoint
): string {
  return JSON.stringify(checkpoint);
}

function deserialize(
  row: CheckpointRow
): AgentRunCheckpoint {
  return JSON.parse(
    row.payload
  ) as AgentRunCheckpoint;
}

export class TransactionalCheckpointStore
  implements CheckpointStore {

  constructor(
    private readonly database:
      TransactionalCheckpointDatabase
  ) {}

  async load(
    runId: string
  ): Promise<AgentRunCheckpoint | undefined> {
    const row =
      await this.database.load(runId);

    return row
      ? structuredClone(deserialize(row))
      : undefined;
  }

  async save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint> {
    const next: AgentRunCheckpoint = {
      ...structuredClone(checkpoint),
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString()
    };

    const row: CheckpointRow = {
      runId: next.runId,
      version: next.version,
      payload: serialize(next),
      updatedAt: next.updatedAt
    };

    const written =
      expectedVersion === 0
        ? await this.database.insertIfAbsent(row)
        : await this.database.updateIfVersion(
            row,
            expectedVersion
          );

    if (!written) {
      const latest =
        await this.database.load(
          checkpoint.runId
        );

      throw new CheckpointConflictError(
        checkpoint.runId,
        expectedVersion,
        latest?.version ?? 0
      );
    }

    return structuredClone(next);
  }
}
