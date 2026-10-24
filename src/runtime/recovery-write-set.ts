import type { RecoveryOperation } from "./recovery-operations.js";

/**
 * Prepared effects determine the write set; a read dependency is not
 * necessarily a mutation. All version compares happen inside the Finalizer
 * transaction, including for "compare" entries.
 */
export type VersionedStateWrite = "compare" | "cas_update";
export type RecoveryPreparationOutcome = "applied" | "rejected" | "no_op";

export interface PreparedRecoveryWriteIntent {
  operation: RecoveryOperation;
  outcome: RecoveryPreparationOutcome;
  checkpointChanged: boolean;
  controlChanged: boolean;
}

export interface RecoveryWriteSet {
  checkpoint: VersionedStateWrite;
  control: VersionedStateWrite;
  command: "terminal_cas";
  outbox: "append_prepared_events";
}

const CONTROL_ONLY_OPERATIONS: ReadonlySet<RecoveryOperation> = new Set([
  "quarantine", "release_quarantine", "dead_letter"
]);

/** Pure planning only: never execute tools or persist state from here. */
export function planRecoveryWriteSet(
  intent: PreparedRecoveryWriteIntent
): RecoveryWriteSet {
  if (
    intent.outcome !== "applied" &&
    (intent.checkpointChanged || intent.controlChanged)
  ) {
    throw new Error(
      "Rejected/no-op recovery cannot claim persisted state mutations"
    );
  }

  if (
    CONTROL_ONLY_OPERATIONS.has(intent.operation) &&
    intent.checkpointChanged
  ) {
    throw new Error(
      "Control-only operation must not bump Checkpoint version"
    );
  }

  return {
    checkpoint: intent.checkpointChanged ? "cas_update" : "compare",
    control: intent.controlChanged ? "cas_update" : "compare",
    command: "terminal_cas",
    outbox: "append_prepared_events"
  };
}
