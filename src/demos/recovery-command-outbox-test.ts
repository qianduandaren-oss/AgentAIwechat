import {
  DurableRecoveryCommandExecutor,
  InMemoryRecoveryCommandStore,
  type DurableRecoveryCommandRecord
} from "../runtime/recovery-command-store.js";
import {
  InMemoryRecoveryOutboxStore,
  RecoveryOutboxDispatcher,
  type RecoveryOutboxRecord,
  type RecoveryOutboxStore
} from "../runtime/recovery-outbox.js";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const commandStore = new InMemoryRecoveryCommandStore();
const commandExecutor = new DurableRecoveryCommandExecutor(
  commandStore,
  () => "2026-10-05T04:00:00.000Z"
);

const command: DurableRecoveryCommandRecord = {
  commandId: "cmd-001",
  runId: "run-001",
  operation: "resume",
  requestedBy: "operator",
  reason: "service recovered",
  expectedCheckpointVersion: 12,
  expectedControlVersion: 3,
  status: "accepted",
  version: 0,
  createdAt: "2026-10-05T04:00:00.000Z",
  updatedAt: "2026-10-05T04:00:00.000Z"
};

let handlerCalls = 0;

const first = await commandExecutor.executeOnce(
  command,
  async () => {
    handlerCalls += 1;
    return "recovery_advanced";
  }
);

const duplicate = await commandExecutor.executeOnce(
  command,
  async () => {
    handlerCalls += 1;
    return "should_not_run";
  }
);

assert(
  first.status === "succeeded" &&
  duplicate.status === "succeeded",
  "duplicate command should return the durable terminal state"
);
assert(
  handlerCalls === 1,
  "same commandId must not execute twice"
);

const innerStore = new InMemoryRecoveryOutboxStore();

const outbox: RecoveryOutboxRecord = {
  id: "outbox-001",
  eventId: "event-001",
  commandId: "cmd-001",
  runId: "run-001",
  kind: "audit",
  payload: JSON.stringify({ outcome: "executed" }),
  status: "pending",
  attempts: 0,
  version: 0,
  createdAt: "2026-10-05T04:01:00.000Z",
  updatedAt: "2026-10-05T04:01:00.000Z"
};

assert(
  await innerStore.enqueueIfAbsent(outbox),
  "first enqueue should succeed"
);
assert(
  !(await innerStore.enqueueIfAbsent(outbox)),
  "duplicate outbox id should not create another record"
);

class FailFirstMarkStore implements RecoveryOutboxStore {
  private failNext = true;

  constructor(
    private readonly inner: RecoveryOutboxStore
  ) {}

  load(id: string) {
    return this.inner.load(id);
  }

  enqueueIfAbsent(record: RecoveryOutboxRecord) {
    return this.inner.enqueueIfAbsent(record);
  }

  listPending(limit?: number) {
    return this.inner.listPending(limit);
  }

  markAttempt(
    id: string,
    expectedVersion: number,
    updatedAt: string
  ) {
    return this.inner.markAttempt(
      id,
      expectedVersion,
      updatedAt
    );
  }

  async markDispatched(
    id: string,
    expectedVersion: number,
    dispatchedAt: string
  ) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated mark dispatched failure");
    }

    return this.inner.markDispatched(
      id,
      expectedVersion,
      dispatchedAt
    );
  }
}

const flakyStore = new FailFirstMarkStore(innerStore);
let deliveries = 0;
let applied = 0;
const seen = new Set<string>();

const dispatcher = new RecoveryOutboxDispatcher(
  flakyStore,
  {
    publish(record) {
      deliveries += 1;

      if (seen.has(record.eventId)) {
        return;
      }

      seen.add(record.eventId);
      applied += 1;
    }
  },
  () => "2026-10-05T04:02:00.000Z"
);

const firstDispatch = await dispatcher.dispatchPending();

assert(
  firstDispatch.failed === 1 &&
  firstDispatch.dispatched === 0,
  "publish success plus mark failure should leave the outbox pending"
);

const afterFirst = await innerStore.load("outbox-001");

assert(
  afterFirst?.status === "pending" &&
  afterFirst.attempts === 1,
  "pending outbox must survive a failed acknowledgement"
);

const secondDispatch = await dispatcher.dispatchPending();

assert(
  secondDispatch.dispatched === 1,
  "a later dispatcher pass should retry the pending event"
);

const finalRecord = await innerStore.load("outbox-001");

assert(
  deliveries === 2,
  "at-least-once delivery may publish the same event twice"
);
assert(
  applied === 1,
  "consumer should deduplicate repeated eventId"
);
assert(
  finalRecord?.status === "dispatched" &&
  finalRecord.attempts === 2,
  "outbox should finish dispatched after retry"
);

console.log("recovery command and outbox tests passed");
