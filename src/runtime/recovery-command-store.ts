import type {
  RecoveryOperation,
  RecoveryOperationResultStatus
} from "./recovery-operations.js";

export type RecoveryCommandStatus =
  | "accepted" | "executing" | "succeeded" | "rejected" | "failed";

export interface RecoveryCommandResultSnapshot {
  status: RecoveryOperationResultStatus;
  reason: string;
  checkpointVersion: number;
  controlVersion: number;
}

export interface DurableRecoveryCommandRecord {
  commandId: string;
  runId: string;
  operation: RecoveryOperation;
  requestedBy: string;
  reason: string;
  expectedCheckpointVersion: number;
  expectedControlVersion?: number;
  status: RecoveryCommandStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  resultReason?: string;
  resultSnapshot?: RecoveryCommandResultSnapshot;
}

export class RecoveryCommandConflictError extends Error {
  constructor(
    public readonly commandId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(`Recovery command conflict for ${commandId}: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "RecoveryCommandConflictError";
  }
}

export interface RecoveryCommandStore {
  load(commandId: string): Promise<DurableRecoveryCommandRecord | undefined>;
  insertIfAbsent(record: DurableRecoveryCommandRecord): Promise<boolean>;
  updateIfVersion(record: DurableRecoveryCommandRecord, expectedVersion: number): Promise<DurableRecoveryCommandRecord>;
}

export class InMemoryRecoveryCommandStore implements RecoveryCommandStore {
  private readonly records = new Map<string, DurableRecoveryCommandRecord>();

  async load(commandId: string) {
    const record = this.records.get(commandId);
    return record ? structuredClone(record) : undefined;
  }

  async insertIfAbsent(record: DurableRecoveryCommandRecord): Promise<boolean> {
    if (this.records.has(record.commandId)) return false;
    this.records.set(record.commandId, structuredClone({ ...record, version: 1 }));
    return true;
  }

  async updateIfVersion(
    record: DurableRecoveryCommandRecord,
    expectedVersion: number
  ): Promise<DurableRecoveryCommandRecord> {
    const current = this.records.get(record.commandId);
    const actualVersion = current?.version ?? 0;
    if (actualVersion !== expectedVersion) {
      throw new RecoveryCommandConflictError(
        record.commandId,
        expectedVersion,
        actualVersion
      );
    }
    const saved = { ...structuredClone(record), version: actualVersion + 1 };
    this.records.set(record.commandId, saved);
    return structuredClone(saved);
  }
}

export class DurableRecoveryCommandExecutor {
  constructor(
    private readonly store: RecoveryCommandStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async executeOnce(
    record: DurableRecoveryCommandRecord,
    handler: () => Promise<string> | string
  ): Promise<DurableRecoveryCommandRecord> {
    const inserted = await this.store.insertIfAbsent(record);
    let current = await this.require(record.commandId);

    if (!inserted && current.status !== "accepted") return current;

    try {
      current = await this.store.updateIfVersion(
        { ...current, status: "executing", updatedAt: this.now() },
        current.version
      );
    } catch (error) {
      if (error instanceof RecoveryCommandConflictError) {
        return this.require(record.commandId);
      }
      throw error;
    }

    try {
      const resultReason = await handler();
      return this.store.updateIfVersion(
        { ...current, status: "succeeded", resultReason, updatedAt: this.now() },
        current.version
      );
    } catch (error) {
      await this.store.updateIfVersion(
        {
          ...current,
          status: "failed",
          resultReason: error instanceof Error ? error.message : "command_execution_failed",
          updatedAt: this.now()
        },
        current.version
      );
      throw error;
    }
  }

  private async require(commandId: string): Promise<DurableRecoveryCommandRecord> {
    const record = await this.store.load(commandId);
    if (!record) throw new Error(`Recovery command not found: ${commandId}`);
    return record;
  }
}
