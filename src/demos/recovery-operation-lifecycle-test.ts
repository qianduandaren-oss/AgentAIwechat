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

const controls =
  new InMemoryRecoveryControlStore();

const audit =
  new InMemoryAuditSink();

const service =
  new RecoveryOperationService(
    store,
    coordinator,
    new StaticRecoveryOperationAuthorizer({
      admin: [
        "retry_recovery",
        "reconcile_again",
        "quarantine",
        "release_quarantine",
        "resume",
        "dead_letter"
      ]
    }),
    controls,
    audit
  );

const seed =
  await store.save(
    upsertToolExecution(
      {
        ...createInitialCheckpoint(
          "run-lifecycle"
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

const quarantined =
  await service.execute({
    runId: "run-lifecycle",
    operation: "quarantine",
    requestedBy: "admin",
    reason: "investigate uncertain effect",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 0
  });

assert(
  quarantined.status ===
    "quarantined",
  "active run should enter quarantine"
);

assert(
  quarantined.controlState.version === 1,
  "quarantine should advance control version"
);

const blockedRetry =
  await service.execute({
    runId: "run-lifecycle",
    operation: "retry_recovery",
    requestedBy: "admin",
    reason: "retry while quarantined",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 1
  });

assert(
  blockedRetry.status ===
    "rejected" &&
  blockedRetry.reason ===
    "run_quarantined",
  "quarantine should block normal recovery"
);

const staleRelease =
  await service.execute({
    runId: "run-lifecycle",
    operation:
      "release_quarantine",
    requestedBy: "admin",
    reason: "stale control page",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 0
  });

assert(
  staleRelease.status ===
    "rejected" &&
  staleRelease.reason ===
    "control_version_conflict",
  "stale operational command should be rejected"
);

const released =
  await service.execute({
    runId: "run-lifecycle",
    operation:
      "release_quarantine",
    requestedBy: "admin",
    reason: "investigation complete",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 1
  });

assert(
  released.status === "released" &&
  released.controlState.status === "active" &&
  released.controlState.version === 2,
  "release should reactivate the run"
);

const quarantinedAgain =
  await service.execute({
    runId: "run-lifecycle",
    operation: "quarantine",
    requestedBy: "admin",
    reason: "hold before explicit resume",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 2
  });

assert(
  quarantinedAgain.controlState.version === 3,
  "second quarantine should advance control version"
);

const resumed =
  await service.execute({
    runId: "run-lifecycle",
    operation: "resume",
    requestedBy: "admin",
    reason: "resume through runtime",
    expectedCheckpointVersion:
      seed.version,
    expectedControlVersion: 3
  });

assert(
  resumed.status === "executed",
  "resume should re-enter the recovery coordinator"
);

assert(
  resumed.controlState.status === "active" &&
  resumed.controlState.version === 4,
  "resume should release quarantine before recovery"
);

assert(
  resumed.checkpoint
    .toolExecutions[0]
    ?.outcome === "executed",
  "resume must rely on reconciliation rather than direct tool execution"
);

const deadSeed =
  await store.save(
    createInitialCheckpoint(
      "run-dead-letter"
    ),
    0
  );

const deadLettered =
  await service.execute({
    runId: "run-dead-letter",
    operation: "dead_letter",
    requestedBy: "admin",
    reason: "requires offline handling",
    expectedCheckpointVersion:
      deadSeed.version,
    expectedControlVersion: 0
  });

assert(
  deadLettered.status ===
    "dead_lettered" &&
  deadLettered.controlState.status ===
    "dead_lettered",
  "dead-letter should create terminal operational state"
);

const retryDeadLettered =
  await service.execute({
    runId: "run-dead-letter",
    operation: "retry_recovery",
    requestedBy: "admin",
    reason: "should stay blocked",
    expectedCheckpointVersion:
      deadSeed.version,
    expectedControlVersion: 1
  });

assert(
  retryDeadLettered.status ===
    "rejected" &&
  retryDeadLettered.reason ===
    "run_dead_lettered",
  "dead-lettered run must not re-enter recovery"
);

const auditEvents =
  await audit.list();

assert(
  auditEvents.length === 8,
  "all lifecycle operations should be audited"
);

console.log(
  "recovery operation lifecycle tests passed"
);
