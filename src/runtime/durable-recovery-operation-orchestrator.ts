import type {
  DurableRecoveryCommandRecord
} from "./recovery-command-store.js";
import type {
  RecoveryOperationCommand
} from "./recovery-operations.js";

export interface DurableRecoveryOperationCommand
  extends RecoveryOperationCommand {
  commandId: string;
}

export type DurableRecoveryOperationDecision =
  | {
      action: "accept_new";
    }
  | {
      action: "replay_terminal";
      record: DurableRecoveryCommandRecord;
    }
  | {
      action: "resume_in_flight";
      record: DurableRecoveryCommandRecord;
    };

export class RecoveryCommandIdentityConflictError
  extends Error {
  constructor(
    public readonly commandId: string
  ) {
    super(
      `Recovery command identity conflict: ${commandId} was already bound to another request`
    );
    this.name =
      "RecoveryCommandIdentityConflictError";
  }
}

const TERMINAL_STATUSES =
  new Set<DurableRecoveryCommandRecord["status"]>([
    "succeeded",
    "rejected",
    "failed"
  ]);

function sameRequest(
  record: DurableRecoveryCommandRecord,
  command: DurableRecoveryOperationCommand
): boolean {
  return (
    record.commandId === command.commandId &&
    record.runId === command.runId &&
    record.operation === command.operation &&
    record.requestedBy === command.requestedBy &&
    record.reason === command.reason &&
    record.expectedCheckpointVersion ===
      command.expectedCheckpointVersion &&
    record.expectedControlVersion ===
      command.expectedControlVersion
  );
}

export function decideDurableRecoveryOperation(
  existing: DurableRecoveryCommandRecord | undefined,
  command: DurableRecoveryOperationCommand
): DurableRecoveryOperationDecision {
  if (!existing) {
    return {
      action: "accept_new"
    };
  }

  if (!sameRequest(existing, command)) {
    throw new RecoveryCommandIdentityConflictError(
      command.commandId
    );
  }

  if (TERMINAL_STATUSES.has(existing.status)) {
    return {
      action: "replay_terminal",
      record: structuredClone(existing)
    };
  }

  return {
    action: "resume_in_flight",
    record: structuredClone(existing)
  };
}
