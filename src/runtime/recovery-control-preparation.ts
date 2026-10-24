import type { AgentRunCheckpoint } from "./checkpoint.js";
import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type {
  RecoveryAuthorizationDecision,
  RecoveryControlState,
  RecoveryOperationResultStatus
} from "./recovery-operations.js";
import {
  planRecoveryWriteSet,
  type RecoveryWriteSet
} from "./recovery-write-set.js";

/**
 * Side-effect-free preparation for control-only operations. This is NOT a
 * replacement for the legacy RecoveryOperationService or the live router.
 * The caller must use a single SQLite Finalizer transaction to persist it.
 */
export type ControlOnlyRecoveryOperation =
  | "quarantine"
  | "release_quarantine"
  | "dead_letter";

export interface ControlOnlyPreparationInput {
  command: DurableRecoveryOperationCommand;
  checkpoint: AgentRunCheckpoint;
  control?: RecoveryControlState;
  authorization: RecoveryAuthorizationDecision;
  timestamp: string;
}

export interface PreparedControlOnlyRecovery {
  commandId: string;
  runId: string;
  operation: ControlOnlyRecoveryOperation;
  outcome: "applied" | "rejected" | "no_op";
  status: RecoveryOperationResultStatus;
  reason: string;
  checkpoint: AgentRunCheckpoint;
  control: RecoveryControlState;
  expectedCheckpointVersion: number;
  expectedControlVersion: number;
  writeSet: RecoveryWriteSet;
}

/**
 * No I/O, no audit, no coordinator call and no mutation of the inputs.
 * An already-committed command must be replayed BEFORE calling this function.
 */
export function prepareControlOnlyRecovery(
  input: ControlOnlyPreparationInput
): PreparedControlOnlyRecovery {
  const { command, checkpoint, authorization } = input;
  if (
    command.operation !== "quarantine" &&
    command.operation !== "release_quarantine" &&
    command.operation !== "dead_letter"
  ) {
    throw new Error("Unsupported control-only recovery operation");
  }

  if (
    !command.commandId.trim() ||
    checkpoint.runId !== command.runId ||
    (input.control && input.control.runId !== command.runId)
  ) {
    throw new Error("Recovery preparation identity mismatch");
  }

  const control: RecoveryControlState = input.control
    ? structuredClone(input.control)
    : {
        runId: command.runId,
        version: 0,
        status: "active",
        updatedAt: input.timestamp
      };
  const currentCheckpoint = structuredClone(checkpoint);
  let outcome: PreparedControlOnlyRecovery["outcome"] = "applied";
  let status: RecoveryOperationResultStatus = "quarantined";
  let reason = "run_quarantined";
  let nextStatus: RecoveryControlState["status"] = "quarantined";

  if (!authorization.allowed) {
    outcome = "rejected";
    status = "rejected";
    reason = authorization.reason;
  } else if (checkpoint.version !== command.expectedCheckpointVersion) {
    outcome = "rejected";
    status = "rejected";
    reason = "checkpoint_version_conflict";
  } else if (control.version !== (command.expectedControlVersion ?? 0)) {
    outcome = "rejected";
    status = "rejected";
    reason = "control_version_conflict";
  } else if (checkpoint.boundary === "completed") {
    outcome = "no_op";
    status = "no_op";
    reason = "checkpoint_already_completed";
  } else if (control.status === "dead_lettered") {
    outcome = "rejected";
    status = "rejected";
    reason = "run_dead_lettered";
  } else if (command.operation === "quarantine") {
    if (control.status === "quarantined") {
      outcome = "no_op";
      status = "no_op";
      reason = "run_already_quarantined";
    }
  } else if (command.operation === "release_quarantine") {
    if (control.status !== "quarantined") {
      outcome = "rejected";
      status = "rejected";
      reason = "release_requires_quarantine";
    } else {
      status = "released";
      reason = "run_released";
      nextStatus = "active";
    }
  } else {
    status = "dead_lettered";
    reason = "run_dead_lettered";
    nextStatus = "dead_lettered";
  }

  const changed = outcome === "applied";
  if (changed) {
    Object.assign(control, {
      status: nextStatus,
      reason: command.reason,
      updatedBy: command.requestedBy,
      updatedAt: input.timestamp,
      causedByCommandId: command.commandId
    });
  }

  return {
    commandId: command.commandId,
    runId: command.runId,
    operation: command.operation,
    outcome,
    status,
    reason,
    checkpoint: currentCheckpoint,
    control,
    expectedCheckpointVersion: command.expectedCheckpointVersion,
    expectedControlVersion: command.expectedControlVersion ?? 0,
    writeSet: planRecoveryWriteSet({
      operation: command.operation,
      outcome,
      checkpointChanged: false,
      controlChanged: changed
    })
  };
}
