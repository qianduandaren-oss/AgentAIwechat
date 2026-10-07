import type {
  AgentRunCheckpoint
} from "./checkpoint.js";
import type {
  CheckpointStore
} from "./checkpoint-store.js";
import {
  RecoveryCommandConflictError,
  type DurableRecoveryCommandRecord,
  type RecoveryCommandResultSnapshot,
  type RecoveryCommandStore
} from "./recovery-command-store.js";
import type {
  RecoveryControlStore,
  RecoveryOperationCommand,
  RecoveryOperationResult,
  RecoveryOperationalStatus
} from "./recovery-operations.js";

export interface DurableRecoveryOperationCommand
  extends RecoveryOperationCommand {
  commandId: string;
}

export type DurableRecoveryOperationDecision =
  | { action: "accept_new" }
  | {
      action: "replay_terminal";
      record: DurableRecoveryCommandRecord;
    }
  | {
      action: "resume_in_flight";
      record: DurableRecoveryCommandRecord;
    };

export class RecoveryCommandIdentityConflictError extends Error {
  constructor(public readonly commandId: string) {
    super(
      `Recovery command identity conflict: ${commandId} was already bound to another request`
    );
    this.name = "RecoveryCommandIdentityConflictError";
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
    record.expectedCheckpointVersion === command.expectedCheckpointVersion &&
    record.expectedControlVersion === command.expectedControlVersion
  );
}

export function decideDurableRecoveryOperation(
  existing: DurableRecoveryCommandRecord | undefined,
  command: DurableRecoveryOperationCommand
): DurableRecoveryOperationDecision {
  if (!existing) {
    return { action: "accept_new" };
  }

  if (!sameRequest(existing, command)) {
    throw new RecoveryCommandIdentityConflictError(command.commandId);
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

export interface RecoveryOperationExecutor {
  execute(
    command: RecoveryOperationCommand
  ): Promise<RecoveryOperationResult>;
}

export interface DurableRecoveryOperationFacts {
  checkpointVersion: number;
  checkpointBoundary: AgentRunCheckpoint["boundary"];
  controlVersion: number;
  controlStatus: RecoveryOperationalStatus;
}

export type DurableRecoveryOperationExecution =
  | {
      action: "executed_new";
      record: DurableRecoveryCommandRecord;
      resultSnapshot?: RecoveryCommandResultSnapshot;
    }
  | {
      action: "replayed_terminal";
      record: DurableRecoveryCommandRecord;
      resultSnapshot?: RecoveryCommandResultSnapshot;
    }
  | {
      action: "resume_in_flight";
      record: DurableRecoveryCommandRecord;
      facts: DurableRecoveryOperationFacts;
    };

export class DurableRecoveryOperationOrchestrator {
  private readonly now: () => string;

  constructor(
    private readonly commandStore: RecoveryCommandStore,
    private readonly executor: RecoveryOperationExecutor,
    private readonly checkpointStore: CheckpointStore,
    private readonly controlStore: RecoveryControlStore,
    options: { now?: () => string } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(
    command: DurableRecoveryOperationCommand
  ): Promise<DurableRecoveryOperationExecution> {
    const existing =
      await this.commandStore.load(command.commandId);

    return this.routeExisting(existing, command);
  }

  private async routeExisting(
    existing: DurableRecoveryCommandRecord | undefined,
    command: DurableRecoveryOperationCommand
  ): Promise<DurableRecoveryOperationExecution> {
    const decision =
      decideDurableRecoveryOperation(existing, command);

    if (decision.action === "replay_terminal") {
      return {
        action: "replayed_terminal",
        record: decision.record,
        resultSnapshot: decision.record.resultSnapshot
      };
    }

    if (decision.action === "resume_in_flight") {
      return {
        action: "resume_in_flight",
        record: decision.record,
        facts: await this.loadCurrentFacts(command.runId)
      };
    }

    return this.acceptAndExecute(command);
  }

  private async acceptAndExecute(
    command: DurableRecoveryOperationCommand
  ): Promise<DurableRecoveryOperationExecution> {
    const timestamp = this.now();

    const inserted =
      await this.commandStore.insertIfAbsent({
        commandId: command.commandId,
        runId: command.runId,
        operation: command.operation,
        requestedBy: command.requestedBy,
        reason: command.reason,
        expectedCheckpointVersion: command.expectedCheckpointVersion,
        expectedControlVersion: command.expectedControlVersion,
        status: "accepted",
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    if (!inserted) {
      return this.routeExisting(
        await this.requireCommand(command.commandId),
        command
      );
    }

    let current =
      await this.requireCommand(command.commandId);

    try {
      current =
        await this.commandStore.updateIfVersion(
          {
            ...current,
            status: "executing",
            updatedAt: this.now()
          },
          current.version
        );
    } catch (error) {
      if (error instanceof RecoveryCommandConflictError) {
        return this.routeExisting(
          await this.requireCommand(command.commandId),
          command
        );
      }
      throw error;
    }

    try {
      const result =
        await this.executor.execute(
          toOperationCommand(command)
        );

      const snapshot = toResultSnapshot(result);
      const terminalStatus =
        result.status === "rejected"
          ? "rejected"
          : "succeeded";

      try {
        const saved =
          await this.commandStore.updateIfVersion(
            {
              ...current,
              status: terminalStatus,
              resultReason: result.reason,
              resultSnapshot: snapshot,
              updatedAt: this.now()
            },
            current.version
          );

        return {
          action: "executed_new",
          record: saved,
          resultSnapshot: snapshot
        };
      } catch (error) {
        if (error instanceof RecoveryCommandConflictError) {
          return this.routeExisting(
            await this.requireCommand(command.commandId),
            command
          );
        }
        throw error;
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "recovery_operation_failed";

      try {
        const failed =
          await this.commandStore.updateIfVersion(
            {
              ...current,
              status: "failed",
              resultReason: reason,
              updatedAt: this.now()
            },
            current.version
          );

        return {
          action: "executed_new",
          record: failed
        };
      } catch (updateError) {
        if (updateError instanceof RecoveryCommandConflictError) {
          return this.routeExisting(
            await this.requireCommand(command.commandId),
            command
          );
        }
        throw updateError;
      }
    }
  }

  private async loadCurrentFacts(
    runId: string
  ): Promise<DurableRecoveryOperationFacts> {
    const checkpoint =
      await this.checkpointStore.load(runId);

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${runId}`);
    }

    const control =
      await this.controlStore.load(runId);

    return {
      checkpointVersion: checkpoint.version,
      checkpointBoundary: checkpoint.boundary,
      controlVersion: control?.version ?? 0,
      controlStatus: control?.status ?? "active"
    };
  }

  private async requireCommand(
    commandId: string
  ): Promise<DurableRecoveryCommandRecord> {
    const record =
      await this.commandStore.load(commandId);

    if (!record) {
      throw new Error(
        `Recovery command not found: ${commandId}`
      );
    }

    return record;
  }
}

function toOperationCommand(
  command: DurableRecoveryOperationCommand
): RecoveryOperationCommand {
  return {
    runId: command.runId,
    operation: command.operation,
    requestedBy: command.requestedBy,
    reason: command.reason,
    expectedCheckpointVersion: command.expectedCheckpointVersion,
    expectedControlVersion: command.expectedControlVersion
  };
}

function toResultSnapshot(
  result: RecoveryOperationResult
): RecoveryCommandResultSnapshot {
  return {
    status: result.status,
    reason: result.reason,
    checkpointVersion: result.checkpoint.version,
    controlVersion: result.controlState.version
  };
}
