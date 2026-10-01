import {
  createInitialCheckpoint
} from "../runtime/checkpoint.js";
import {
  CheckpointConflictError
} from "../runtime/checkpoint-store.js";
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

console.log(
  "transactional checkpoint multi-instance CAS tests passed"
);
