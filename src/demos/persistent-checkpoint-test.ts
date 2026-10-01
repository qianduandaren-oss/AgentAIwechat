import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import {
  CheckpointConflictError
} from "../runtime/checkpoint-store.js";
import {
  FileCheckpointStore
} from "../runtime/file-checkpoint-store.js";

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

const filePath =
  `tmp/persistent-checkpoint-${Date.now()}.json`;

const storeA =
  new FileCheckpointStore(filePath);

const initial =
  createInitialCheckpoint(
    "run-restart"
  );

const v1 =
  await storeA.save(
    initial,
    0
  );

const started =
  upsertToolExecution(
    {
      ...v1,
      step: 3,
      boundary: "reconciling_tool"
    },
    {
      toolCallId: "refund-call-1",
      toolName: "execute_refund",
      outcome: "started",
      idempotencyKey: "refund-001",
      sideEffect:
        "external_side_effect",
      retrySafe: false
    }
  );

const v2 =
  await storeA.save(
    started,
    v1.version
  );

// Simulate a process/store restart by creating a new store instance.
const storeB =
  new FileCheckpointStore(filePath);

const recovered =
  await storeB.load(
    "run-restart"
  );

assert(
  recovered?.version === 2,
  "checkpoint should survive store restart"
);

assert(
  recovered?.step === 3,
  "step should survive restart"
);

assert(
  recovered?.boundary ===
    "reconciling_tool",
  "resume boundary should survive restart"
);

assert(
  recovered?.toolExecutions[0]
    ?.outcome === "started",
  "tool execution record should survive restart"
);

assert(
  recovered?.toolExecutions[0]
    ?.idempotencyKey === "refund-001",
  "idempotency key should survive restart"
);

// Two store instances in the same process read the same version.
const workerA =
  await storeA.load(
    "run-restart"
  );

const workerB =
  await storeB.load(
    "run-restart"
  );

assert(
  workerA?.version === 2 &&
  workerB?.version === 2,
  "both workers should begin from v2"
);

const v3 =
  await storeA.save(
    {
      ...workerA,
      boundary:
        "ready_for_next_step"
    },
    workerA.version
  );

let conflicted = false;

try {
  await storeB.save(
    {
      ...workerB,
      boundary: "completed"
    },
    workerB.version
  );
} catch (error) {
  conflicted =
    error instanceof
    CheckpointConflictError;
}

assert(
  conflicted,
  "stale file checkpoint write should conflict"
);

const latest =
  await storeB.load(
    "run-restart"
  );

assert(
  latest?.version === v3.version,
  "latest version should remain the successful worker version"
);

assert(
  latest?.boundary ===
    "ready_for_next_step",
  "stale payload must not overwrite the successful worker"
);

console.log(
  "persistent checkpoint restart/CAS tests passed"
);
