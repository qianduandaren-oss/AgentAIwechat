import { mkdir } from "node:fs/promises";
import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import { CheckpointRecoveryCoordinator } from "../runtime/checkpoint-recovery-coordinator.js";
import { ReconcilerRegistry } from "../runtime/reconciler.js";
import { SQLiteTransactionalCheckpointDatabase } from "../runtime/sqlite-checkpoint-database.js";
import { TransactionalCheckpointStore } from "../runtime/transactional-checkpoint-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

await mkdir("tmp", { recursive: true });

const databasePath = `tmp/sqlite-recovery-${Date.now()}.db`;

const bootstrapDatabase =
  new SQLiteTransactionalCheckpointDatabase(databasePath);
const bootstrapStore =
  new TransactionalCheckpointStore(bootstrapDatabase);

const initial = createInitialCheckpoint("run-sqlite-recovery");
const v1 = await bootstrapStore.save(initial, 0);

const started = upsertToolExecution(
  {
    ...v1,
    step: 3,
    boundary: "reconciling_tool"
  },
  {
    toolCallId: "message-call-1",
    toolName: "send_message",
    outcome: "started",
    idempotencyKey: "message-001",
    sideEffect: "external_side_effect",
    retrySafe: false
  }
);

const v2 = await bootstrapStore.save(started, v1.version);

assert(
  v2.version === 2,
  "bootstrap process should persist started outcome as v2"
);

bootstrapDatabase.close();

const databaseA =
  new SQLiteTransactionalCheckpointDatabase(databasePath);
const databaseB =
  new SQLiteTransactionalCheckpointDatabase(databasePath);

const storeA = new TransactionalCheckpointStore(databaseA);
const storeB = new TransactionalCheckpointStore(databaseB);

const registryA = new ReconcilerRegistry();
registryA.register("send_message", {
  async reconcile() {
    return "executed";
  }
});

const workerBEnteredReconcile = deferred();
const releaseWorkerB = deferred();
let workerBReconcileCalls = 0;

const registryB = new ReconcilerRegistry();
registryB.register("send_message", {
  async reconcile() {
    workerBReconcileCalls += 1;
    workerBEnteredReconcile.resolve();
    await releaseWorkerB.promise;
    return "executed";
  }
});

const coordinatorA =
  new CheckpointRecoveryCoordinator(storeA, registryA);
const coordinatorB =
  new CheckpointRecoveryCoordinator(storeB, registryB);

const workerBPromise =
  coordinatorB.recover("run-sqlite-recovery");

await workerBEnteredReconcile.promise;

const workerAResult =
  await coordinatorA.recover("run-sqlite-recovery");

assert(
  workerAResult.checkpoint.version === 3,
  "worker A should advance v2 to v3"
);
assert(
  workerAResult.checkpoint.boundary === "ready_for_next_step",
  "worker A should move to ready_for_next_step"
);

releaseWorkerB.resolve();
const workerBResult = await workerBPromise;

assert(
  workerBResult.conflicts === 1,
  "worker B should observe one SQLite CAS conflict"
);
assert(
  workerBResult.checkpoint.version === 3,
  "worker B should reload the latest v3"
);
assert(
  workerBResult.checkpoint.toolExecutions[0]?.outcome === "executed",
  "worker B should observe executed outcome after reload"
);
assert(
  workerBReconcileCalls === 1,
  "worker B must not reconcile again after reload discovers executed outcome"
);

const finalCheckpoint =
  await storeB.load("run-sqlite-recovery");

assert(
  finalCheckpoint?.version === 3,
  "final SQLite checkpoint should have one successful recovery transition"
);

databaseA.close();
databaseB.close();

console.log("SQLite crash recovery integration test passed");
