import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import { InMemoryCheckpointStore } from "../runtime/checkpoint-store.js";
import { CheckpointRecoveryCoordinator } from "../runtime/checkpoint-recovery-coordinator.js";
import {
  InMemoryRecoveryEventSink,
  type RecoveryEventSink
} from "../runtime/recovery-observability.js";
import { ReconcilerRegistry } from "../runtime/reconciler.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function createStartedCheckpoint(
  store: InMemoryCheckpointStore,
  runId: string
): Promise<void> {
  const initial = createInitialCheckpoint(runId);
  await store.save(
    upsertToolExecution(
      {
        ...initial,
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
    ),
    0
  );
}

const store = new InMemoryCheckpointStore();
await createStartedCheckpoint(store, "run-observability");

const registry = new ReconcilerRegistry();
registry.register("send_message", {
  async reconcile() {
    return "executed";
  }
});

const sink = new InMemoryRecoveryEventSink();
const coordinator = new CheckpointRecoveryCoordinator(
  store,
  registry,
  {
    eventSink: sink,
    attemptIdFactory: () => "attempt-1",
    now: () => "2026-10-03T04:00:00.000Z"
  }
);

const result = await coordinator.recover("run-observability");
assert(result.status === "advanced", "recovery should advance");

const eventTypes = sink.list().map(event => event.type);
assert(
  eventTypes.join(",") ===
    [
      "recovery_started",
      "checkpoint_loaded",
      "plan_decided",
      "reconciliation_started",
      "reconciliation_completed",
      "checkpoint_saved",
      "recovery_completed"
    ].join(","),
  "recovery event sequence should be complete"
);

assert(
  sink.list().every(
    event => event.recoveryAttemptId === "attempt-1"
  ),
  "all events should share the recovery attempt id"
);

class FailingSink implements RecoveryEventSink {
  record(): void {
    throw new Error("sink unavailable");
  }
}

const failingStore = new InMemoryCheckpointStore();
await createStartedCheckpoint(failingStore, "run-failing-sink");

const failingCoordinator = new CheckpointRecoveryCoordinator(
  failingStore,
  registry,
  {
    eventSink: new FailingSink(),
    attemptIdFactory: () => "attempt-2"
  }
);

const failingResult =
  await failingCoordinator.recover("run-failing-sink");

assert(
  failingResult.status === "advanced",
  "event sink failure must not turn recovery into failure"
);

console.log("recovery observability test passed");
