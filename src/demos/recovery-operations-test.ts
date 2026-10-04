import {
  createInitialCheckpoint,
  upsertToolExecution
} from "../runtime/checkpoint.js";
import {
  InMemoryCheckpointStore
} from "../runtime/checkpoint-store.js";
import {
  CheckpointRecoveryCoordinator
} from "../runtime/checkpoint-recovery-coordinator.js";
import {
  InMemoryRecoveryControlStore,
  RecoveryOperationService,
  StaticRecoveryOperationAuthorizer
} from "../runtime/recovery-operations.js";
import {
  ReconcilerRegistry
} from "../runtime/reconciler.js";
import {
  InMemoryAuditSink
} from "../security/audit-log.js";

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

const store =
  new InMemoryCheckpointStore();

const registry =
  new ReconcilerRegistry();

registry.register(
  "send_message",
  {
    async reconcile() {
      return "executed";
    }
  }
);

const coordinator =
  new CheckpointRecoveryCoordinator(
    store,
    registry
  );

const audit =
  new InMemoryAuditSink();

const controls =
  new InMemoryRecoveryControlStore();

const service =
  new RecoveryOperationService(
    store,
    coordinator,
    new StaticRecoveryOperationAuthorizer({
      operator: [
        "retry_recovery",
        "reconcile_again"
      ],
      admin: [
        "retry_recovery",
        "reconcile_again",
        "quarantine"
      ],
      viewer: []
    }),
    controls,
    audit
  );

const started =
  await store.save(
    upsertToolExecution(
      {
        ...createInitialCheckpoint(
          "run-day44"
        ),
        boundary:
          "reconciling_tool"
      },
      {
        toolCallId: "message-1",
        toolName: "send_message",
        outcome: "started",
        idempotencyKey: "message-1",
        sideEffect:
          "external_side_effect",
        retrySafe: false
      }
    ),
    0
  );

const recovered =
  await service.execute({
    runId: "run-day44",
    operation: "reconcile_again",
    requestedBy: "operator",
    reason:
      "external service recovered",
    expectedCheckpointVersion:
      started.version
  });

assert(
  recovered.status === "executed",
  "manual command should re-enter recovery"
);

assert(
  recovered.checkpoint
    .toolExecutions[0]
    ?.outcome === "executed",
  "reconciler should determine outcome"
);

const stale =
  await service.execute({
    runId: "run-day44",
    operation: "retry_recovery",
    requestedBy: "operator",
    reason: "stale operator page",
    expectedCheckpointVersion:
      started.version
  });

assert(
  stale.status === "rejected" &&
  stale.reason ===
    "checkpoint_version_conflict",
  "stale operation should be rejected"
);

const denied =
  await service.execute({
    runId: "run-day44",
    operation: "retry_recovery",
    requestedBy: "viewer",
    reason: "viewer request",
    expectedCheckpointVersion:
      recovered.checkpoint.version
  });

assert(
  denied.status === "rejected",
  "unauthorized operation should be rejected"
);

const quarantineSeed =
  await store.save(
    createInitialCheckpoint(
      "run-quarantine"
    ),
    0
  );

const quarantined =
  await service.execute({
    runId: "run-quarantine",
    operation: "quarantine",
    requestedBy: "admin",
    reason: "needs investigation",
    expectedCheckpointVersion:
      quarantineSeed.version
  });

assert(
  quarantined.status ===
    "quarantined",
  "admin should quarantine run"
);

assert(
  (
    await controls.load(
      "run-quarantine"
    )
  )?.status === "quarantined",
  "quarantine must be operational state"
);

const events =
  await audit.list();

assert(
  events.length === 4,
  "every manual operation should be audited"
);

console.log(
  "recovery operation service tests passed"
);
