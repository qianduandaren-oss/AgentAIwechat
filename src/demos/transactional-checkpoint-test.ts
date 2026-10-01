import {
  createInitialCheckpoint,
  upsertToolExecution,
  type AgentRunCheckpoint
} from "../runtime/checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "../runtime/checkpoint-store.js";
import {
  CheckpointRecoveryCoordinator
} from "../runtime/checkpoint-recovery-coordinator.js";
import {
  ReconcilerRegistry
} from "../runtime/reconciler.js";
import {
  TransactionalCheckpointStore,
  type CheckpointRow,
  type TransactionalCheckpointDatabase
} from "../runtime/transactional-checkpoint-store.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(
      `Assertion failed: ${message}`
    );
  }
}

/**
 * Test double for a database whose insert/update methods are atomic.
 * Two store instances share this object to model shared persistent storage.
 */
class InMemoryTransactionalDatabase
  implements TransactionalCheckpointDatabase {

  private readonly rows =
    new Map<string, CheckpointRow>();

  async load(
    runId: string
  ): Promise<CheckpointRow | undefined> {
    const row =
      this.rows.get(runId);

    return row
      ? structuredClone(row)
      : undefined;
  }

  async insertIfAbsent(
    row: CheckpointRow
  ): Promise<boolean> {
    if (this.rows.has(row.runId)) {
      return false;
    }

    this.rows.set(
      row.runId,
      structuredClone(row)
    );

    return true;
  }

  async updateIfVersion(
    row: CheckpointRow,
    expectedVersion: number
  ): Promise<boolean> {
    const current =
      this.rows.get(row.runId);

    if (
      !current ||
      current.version !==
        expectedVersion
    ) {
      return false;
    }

    this.rows.set(
      row.runId,
      structuredClone(row)
    );

    return true;
  }
}

const database =
  new InMemoryTransactionalDatabase();

const storeA =
  new TransactionalCheckpointStore(
    database
  );

const storeB =
  new TransactionalCheckpointStore(
    database
  );

const initial =
  createInitialCheckpoint(
    "run-transactional"
  );

const v1 =
  await storeA.save(
    initial,
    0
  );

assert(
  v1.version === 1,
  "initial insert should create v1"
);

// A second instance can load persisted shared state.
const restarted =
  await storeB.load(
    "run-transactional"
  );

assert(
  restarted?.version === 1,
  "second store instance should read shared v1"
);

const workerA =
  await storeA.load(
    "run-transactional"
  );

const workerB =
  await storeB.load(
    "run-transactional"
  );

assert(
  workerA?.version === 1 &&
  workerB?.version === 1,
  "both workers should read v1"
);

const v2 =
  await storeA.save(
    {
      ...workerA,
      boundary:
        "ready_for_tool"
    },
    workerA.version
  );

assert(
  v2.version === 2,
  "first worker should atomically advance to v2"
);

let conflict:
  CheckpointConflictError | undefined;

try {
  await storeB.save(
    {
      ...workerB,
      boundary: "completed"
    },
    workerB.version
  );
} catch (error) {
  if (
    error instanceof
    CheckpointConflictError
  ) {
    conflict = error;
  } else {
    throw error;
  }
}

assert(
  conflict,
  "stale transactional write should conflict"
);

assert(
  conflict.actualVersion === 2,
  "conflict should report latest version"
);

const latest =
  await storeB.load(
    "run-transactional"
  );

assert(
  latest?.version === 2,
  "database should remain at v2"
);

assert(
  latest?.boundary ===
    "ready_for_tool",
  "stale worker must not overwrite v2"
);

let duplicateInsertConflict = false;

try {
  await storeB.save(
    createInitialCheckpoint(
      "run-transactional"
    ),
    0
  );
} catch (error) {
  duplicateInsertConflict =
    error instanceof
    CheckpointConflictError;
}

assert(
  duplicateInsertConflict,
  "expectedVersion=0 must conflict when run already exists"
);

/**
 * Evening integration:
 * two recovery workers can both reconcile the same persisted v1,
 * but only one recovery state transition may commit.
 */
class InterleavingStore
  implements CheckpointStore {

  private interleaved = false;

  constructor(
    private readonly base:
      TransactionalCheckpointStore,
    private readonly beforeFirstSave:
      () => Promise<void>
  ) {}

  load(
    runId: string
  ): Promise<AgentRunCheckpoint | undefined> {
    return this.base.load(runId);
  }

  async save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint> {
    if (!this.interleaved) {
      this.interleaved = true;
      await this.beforeFirstSave();
    }

    return this.base.save(
      checkpoint,
      expectedVersion
    );
  }
}

const recoveryDatabase =
  new InMemoryTransactionalDatabase();

const recoveryStoreA =
  new TransactionalCheckpointStore(
    recoveryDatabase
  );

const recoveryStoreBBase =
  new TransactionalCheckpointStore(
    recoveryDatabase
  );

const crashCheckpoint =
  upsertToolExecution(
    {
      ...createInitialCheckpoint(
        "run-transactional-recovery"
      ),
      step: 3,
      boundary: "reconciling_tool"
    },
    {
      toolCallId: "external-action-1",
      toolName: "execute_refund",
      outcome: "started",
      idempotencyKey: "effect-001",
      sideEffect:
        "external_side_effect",
      retrySafe: false
    }
  );

const persistedCrash =
  await recoveryStoreA.save(
    crashCheckpoint,
    0
  );

assert(
  persistedCrash.version === 1,
  "crash checkpoint should be persisted as v1"
);

let reconcileCalls = 0;

function createRegistry():
  ReconcilerRegistry {
  const registry =
    new ReconcilerRegistry();

  registry.register(
    "execute_refund",
    {
      async reconcile() {
        reconcileCalls += 1;
        return "executed";
      }
    }
  );

  return registry;
}

const recoveryWorkerA =
  new CheckpointRecoveryCoordinator(
    recoveryStoreA,
    createRegistry()
  );

let workerARecoveredVersion = 0;

const recoveryStoreB =
  new InterleavingStore(
    recoveryStoreBBase,
    async () => {
      const result =
        await recoveryWorkerA.recover(
          "run-transactional-recovery"
        );

      workerARecoveredVersion =
        result.checkpoint.version;
    }
  );

const recoveryWorkerB =
  new CheckpointRecoveryCoordinator(
    recoveryStoreB,
    createRegistry()
  );

const workerBRecoveryResult =
  await recoveryWorkerB.recover(
    "run-transactional-recovery"
  );

assert(
  workerARecoveredVersion === 2,
  "worker A should win the recovery transition and create v2"
);

assert(
  workerBRecoveryResult.conflicts === 1,
  "worker B should observe one transactional CAS conflict"
);

assert(
  workerBRecoveryResult.checkpoint.version === 2,
  "worker B should reload v2 after conflict"
);

assert(
  workerBRecoveryResult.checkpoint.boundary ===
    "ready_for_next_step",
  "reloaded v2 should already be advanced"
);

assert(
  workerBRecoveryResult.checkpoint
    .toolExecutions[0]?.outcome ===
    "executed",
  "reloaded v2 should preserve reconciled outcome"
);

assert(
  reconcileCalls === 2,
  "both workers may query reality, but only one transition may commit"
);

const recoveryLatest =
  await recoveryStoreA.load(
    "run-transactional-recovery"
  );

assert(
  recoveryLatest?.version === 2,
  "shared storage should contain exactly one committed recovery transition"
);

console.log(
  "transactional checkpoint and crash recovery tests passed"
);
