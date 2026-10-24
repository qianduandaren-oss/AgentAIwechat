import {
  decideDurableRecoveryOperation,
  type DurableRecoveryOperationCommand
} from "./durable-recovery-operation-orchestrator.js";
import type {
  DurableRecoveryCommandRecord,
  RecoveryCommandResultSnapshot
} from "./recovery-command-store.js";

/**
 * Additive, side-effect-free admission decision for a future atomic route.
 * This module does NOT execute a command, perform an admission CAS, or wire
 * the legacy Orchestrator to the new SQLite Finalizer.
 */
export type AtomicRecoveryRouteDecision =
  | { action: "legacy_unchanged" }
  | { action: "unsupported_atomic_operation" }
  | { action: "admit_new_control_only" }
  | {
      action: "replay_terminal";
      record: DurableRecoveryCommandRecord;
      resultSnapshot: RecoveryCommandResultSnapshot;
    }
  | {
      action: "suspend_in_flight";
      record: DurableRecoveryCommandRecord;
    };

export class RecoveryTerminalSnapshotMissingError extends Error {
  constructor(public readonly commandId: string) {
    super(`Terminal recovery command ${commandId} has no durable ResultSnapshot`);
    this.name = "RecoveryTerminalSnapshotMissingError";
  }
}

export interface AtomicRecoveryRouteDecisionInput {
  /** Selected BEFORE calling the old handler; never a retry/fallback policy. */
  atomicControlOnlyEnabled: boolean;
  command: DurableRecoveryOperationCommand;
  existing?: DurableRecoveryCommandRecord;
}

function isControlOnly(
  operation: DurableRecoveryOperationCommand["operation"]
): boolean {
  return operation === "quarantine" ||
    operation === "release_quarantine" ||
    operation === "dead_letter";
}

/**
 * Returns a decision, never mutates state or invokes any handler.
 *
 * When the flag is on: only the three control-only operations are eligible.
 * Existing identity must match before replay or suspension. Terminal replay
 * requires a persisted snapshot; accepted/executing must never be re-run.
 * The caller MUST still implement accepted→executing CAS, auth, pure Prepare,
 * one-transaction Finalizer, and durable re-read in a separate gated adapter.
 */
export function selectAtomicRecoveryRoute(
  input: AtomicRecoveryRouteDecisionInput
): AtomicRecoveryRouteDecision {
  if (!input.atomicControlOnlyEnabled) {
    return { action: "legacy_unchanged" };
  }

  if (
    !input.command.commandId.trim() ||
    !input.command.runId.trim() ||
    !input.command.requestedBy.trim()
  ) {
    throw new Error("Atomic recovery command identity is incomplete");
  }

  // Reuse the existing immutable identity contract, including expected
  // versions, instead of introducing a different comparison in the new path.
  const durableDecision = decideDurableRecoveryOperation(
    input.existing, input.command
  );

  if (!isControlOnly(input.command.operation)) {
    return { action: "unsupported_atomic_operation" };
  }

  if (durableDecision.action === "replay_terminal") {
    const snapshot = durableDecision.record.resultSnapshot;
    if (!snapshot) {
      throw new RecoveryTerminalSnapshotMissingError(input.command.commandId);
    }
    return {
      action: "replay_terminal",
      record: durableDecision.record,
      resultSnapshot: structuredClone(snapshot)
    };
  }

  if (durableDecision.action === "resume_in_flight") {
    return {
      action: "suspend_in_flight",
      record: durableDecision.record
    };
  }

  return { action: "admit_new_control_only" };
}
