import { mkdir } from "node:fs/promises";
import { createInitialCheckpoint } from "../runtime/checkpoint.js";
import { CheckpointConflictError } from "../runtime/checkpoint-store.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

await mkdir("tmp", { recursive: true });

const databasePath = `tmp/sqlite-checkpoint-${Date.now()}.db`;

const databaseA = new SQLiteTransactionalCheckpointDatabase(databasePath);
const storeA = new TransactionalCheckpointStore(databaseA);

const v1 = await storeA.save(
  createInitialCheckpoint("run-sqlite"),
  0
);

assert(v1.version === 1, "initial SQLite save should create v1");
databaseA.close();

const databaseB = new SQLiteTransactionalCheckpointDatabase(databasePath);
const storeB = new TransactionalCheckpointStore(databaseB);
const recovered = await storeB.load("run-sqlite");

assert(
  recovered?.version === 1,
  "SQLite checkpoint should survive connection restart"
);

const databaseC = new SQLiteTransactionalCheckpointDatabase(databasePath);
const storeC = new TransactionalCheckpointStore(databaseC);

const workerB = await storeB.load("run-sqlite");
const workerC = await storeC.load("run-sqlite");

assert(
  workerB?.version === 1 && workerC?.version === 1,
  "both connections should start from v1"
);

const v2 = await storeB.save(
  { ...workerB, boundary: "ready_for_tool" },
  workerB.version
);

assert(v2.version === 2, "first connection should advance v1 to v2");

let conflict: CheckpointConflictError | undefined;

try {
  await storeC.save(
    { ...workerC, boundary: "completed" },
    workerC.version
  );
} catch (error) {
  if (error instanceof CheckpointConflictError) {
    conflict = error;
  } else {
    throw error;
  }
}

assert(conflict, "stale SQLite checkpoint write should conflict");
assert(
  conflict.actualVersion === 2,
  "conflict should report SQLite's latest version"
);

const latest = await storeC.load("run-sqlite");

assert(latest?.version === 2, "SQLite should remain at the successful v2");
assert(
  latest?.boundary === "ready_for_tool",
  "stale payload must not overwrite the successful worker"
);

databaseB.close();
databaseC.close();

console.log("SQLite checkpoint restart/two-connection CAS tests passed");
