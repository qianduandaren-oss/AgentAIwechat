import {
  RecoveryCommandIdentityConflictError,
  type DurableRecoveryOperationCommand
} from "../runtime/durable-recovery-operation-orchestrator.js";
import type {
  DurableRecoveryCommandRecord
} from "../runtime/recovery-command-store.js";
import {
  RecoveryTerminalSnapshotMissingError,
  selectAtomicRecoveryRoute
} from "../runtime/recovery-atomic-route-decision.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Day 65 assertion failed: ${message}`);
}

function expectThrows(
  fn: () => unknown,
  errorType: new (...args: never[]) => Error,
  label: string
): void {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  assert(caught instanceof errorType, label);
}

const command: DurableRecoveryOperationCommand = {
  commandId: "cmd-65",
  runId: "run-65",
  operation: "quarantine",
  requestedBy: "operator",
  reason: "inspect_unknown_tool_effect",
  expectedCheckpointVersion: 7,
  expectedControlVersion: 2
};
const snapshot = {
  status: "quarantined" as const,
  reason: "run_quarantined",
  checkpointVersion: 7,
  controlVersion: 3
};
function existing(
  status: DurableRecoveryCommandRecord["status"],
  withSnapshot = false
): DurableRecoveryCommandRecord {
  return {
    ...command, status, version: 2,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...(withSnapshot ? { resultSnapshot: structuredClone(snapshot) } : {})
  };
}
const route = (
  cmd = command,
  record?: DurableRecoveryCommandRecord,
  enabled = true
) => selectAtomicRecoveryRoute({
  atomicControlOnlyEnabled: enabled, command: cmd, existing: record
});

let checks = 0;
function check(condition: unknown, label: string): void {
  assert(condition, label);
  checks += 1;
}

check(route(command, undefined, false).action === "legacy_unchanged",
  "flag off keeps legacy admission unchanged");

check(route().action === "admit_new_control_only",
  "new eligible command must enter gated admission, not the old executor");

check(route({ ...command, operation: "resume" }).action ===
  "unsupported_atomic_operation", "non-control operation fails closed");

const replay = route(command, existing("succeeded", true));
check(replay.action === "replay_terminal" &&
  replay.resultSnapshot.reason === "run_quarantined",
  "terminal success must replay persisted snapshot");

check(route(command, existing("rejected", true)).action ===
  "replay_terminal", "terminal rejection also replays");

check(route(command, existing("accepted")).action ===
  "suspend_in_flight", "accepted must not blindly run again");

check(route(command, existing("executing")).action ===
  "suspend_in_flight", "executing must not blindly run again");

expectThrows(
  () => route({ ...command, reason: "altered_reason" },
    existing("succeeded", true)),
  RecoveryCommandIdentityConflictError,
  "same commandId with changed immutable reason must fail"
);
checks += 1;

expectThrows(
  () => route({ ...command, expectedControlVersion: 3 },
    existing("accepted")),
  RecoveryCommandIdentityConflictError,
  "changed expected version must fail before suspension"
);
checks += 1;

expectThrows(
  () => route(command, existing("failed")),
  RecoveryTerminalSnapshotMissingError,
  "missing terminal snapshot must never trigger prepare"
);
checks += 1;

expectThrows(
  () => route({ ...command, commandId: " " }),
  Error, "empty identity must fail"
);
checks += 1;

const persisted = existing("succeeded", true);
const replayCopy = route(command, persisted);
if (replayCopy.action !== "replay_terminal") {
  throw new Error("expected terminal replay");
}
replayCopy.resultSnapshot.reason = "caller_mutated_copy";
check(persisted.resultSnapshot?.reason === "run_quarantined",
  "replay must not allow mutation of stored snapshot");

console.log(`Day 65 atomic route admission contract: ${checks}/${checks} passed`);
