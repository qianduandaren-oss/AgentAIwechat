export type RecoveryOutboxKind = "audit" | "recovery_event";
export type RecoveryOutboxStatus = "pending" | "dispatched";

export interface RecoveryOutboxRecord {
  id: string;
  eventId: string;
  commandId: string;
  runId: string;
  kind: RecoveryOutboxKind;
  payload: string;
  status: RecoveryOutboxStatus;
  attempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
}

export class RecoveryOutboxConflictError extends Error {
  constructor(
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(`Recovery outbox conflict for ${id}: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "RecoveryOutboxConflictError";
  }
}

export interface RecoveryOutboxStore {
  load(id: string): Promise<RecoveryOutboxRecord | undefined>;
  enqueueIfAbsent(record: RecoveryOutboxRecord): Promise<boolean>;
  listPending(limit?: number): Promise<RecoveryOutboxRecord[]>;
  markAttempt(id: string, expectedVersion: number, updatedAt: string): Promise<RecoveryOutboxRecord>;
  markDispatched(id: string, expectedVersion: number, dispatchedAt: string): Promise<RecoveryOutboxRecord>;
}

export class InMemoryRecoveryOutboxStore implements RecoveryOutboxStore {
  private readonly records = new Map<string, RecoveryOutboxRecord>();

  async load(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async enqueueIfAbsent(record: RecoveryOutboxRecord): Promise<boolean> {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, structuredClone({ ...record, version: 1 }));
    return true;
  }

  async listPending(limit = 100): Promise<RecoveryOutboxRecord[]> {
    return [...this.records.values()]
      .filter(record => record.status === "pending")
      .slice(0, limit)
      .map(record => structuredClone(record));
  }

  async markAttempt(
    id: string,
    expectedVersion: number,
    updatedAt: string
  ): Promise<RecoveryOutboxRecord> {
    const current = await this.require(id);
    this.assertVersion(current, expectedVersion);
    const next = {
      ...current,
      attempts: current.attempts + 1,
      version: current.version + 1,
      updatedAt
    };
    this.records.set(id, next);
    return structuredClone(next);
  }

  async markDispatched(
    id: string,
    expectedVersion: number,
    dispatchedAt: string
  ): Promise<RecoveryOutboxRecord> {
    const current = await this.require(id);
    this.assertVersion(current, expectedVersion);
    const next = {
      ...current,
      status: "dispatched" as const,
      version: current.version + 1,
      updatedAt: dispatchedAt,
      dispatchedAt
    };
    this.records.set(id, next);
    return structuredClone(next);
  }

  private async require(id: string): Promise<RecoveryOutboxRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Recovery outbox record not found: ${id}`);
    return structuredClone(record);
  }

  private assertVersion(
    record: RecoveryOutboxRecord,
    expectedVersion: number
  ): void {
    if (record.version !== expectedVersion) {
      throw new RecoveryOutboxConflictError(
        record.id,
        expectedVersion,
        record.version
      );
    }
  }
}

export interface RecoveryOutboxPublisher {
  publish(record: RecoveryOutboxRecord): Promise<void> | void;
}

export interface RecoveryOutboxDispatchSummary {
  attempted: number;
  dispatched: number;
  failed: number;
}

export class RecoveryOutboxDispatcher {
  constructor(
    private readonly store: RecoveryOutboxStore,
    private readonly publisher: RecoveryOutboxPublisher,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async dispatchPending(limit = 100): Promise<RecoveryOutboxDispatchSummary> {
    const pending = await this.store.listPending(limit);
    let attempted = 0;
    let dispatched = 0;
    let failed = 0;

    for (const record of pending) {
      attempted += 1;
      try {
        const attempt = await this.store.markAttempt(
          record.id,
          record.version,
          this.now()
        );
        await this.publisher.publish(attempt);
        await this.store.markDispatched(
          attempt.id,
          attempt.version,
          this.now()
        );
        dispatched += 1;
      } catch {
        failed += 1;
      }
    }

    return { attempted, dispatched, failed };
  }
}
