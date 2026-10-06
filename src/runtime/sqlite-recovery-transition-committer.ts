import type { AgentRunCheckpoint } from "./checkpoint.js";
import type { DurableRecoveryCommandRecord } from "./recovery-command-store.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import type { RecoveryControlState } from "./recovery-operations.js";
import type { PreparedRecoveryTransition } from "./recovery-preparation.js";
import {
  RecoveryFinalizationConflictError,
  SQLiteRecoveryFinalizationUnitOfWork
} from "./sqlite-recovery-finalization.js";
import {
  RecoveryTransitionCommitConflictError,
  type RecoveryTransitionCommitter
} from "./recovery-transition-committer.js";

export interface SQLiteRecoveryCommitContext {
  control: RecoveryControlState;
  expectedControlVersion: number;
  command: DurableRecoveryCommandRecord;
  expectedCommandVersion: number;
  outbox: RecoveryOutboxRecord[];
}

export type SQLiteRecoveryCommitContextFactory = (
  prepared: PreparedRecoveryTransition
) =>
  | SQLiteRecoveryCommitContext
  | Promise<SQLiteRecoveryCommitContext>;

export class SQLiteRecoveryTransitionCommitter
  implements RecoveryTransitionCommitter {

  constructor(
    private readonly unitOfWork:
      SQLiteRecoveryFinalizationUnitOfWork,
    private readonly buildContext:
      SQLiteRecoveryCommitContextFactory
  ) {}

  async commit(
    prepared: PreparedRecoveryTransition
  ): Promise<AgentRunCheckpoint> {
    if (!prepared.shouldPersist) {
      return structuredClone(
        prepared.nextCheckpoint
      );
    }

    const context =
      await this.buildContext(prepared);

    this.assertContext(
      prepared,
      context
    );

    try {
      const committed =
        this.unitOfWork.commit({
          checkpoint:
            prepared.nextCheckpoint,
          expectedCheckpointVersion:
            prepared.expectedCheckpointVersion,
          control:
            context.control,
          expectedControlVersion:
            context.expectedControlVersion,
          command:
            context.command,
          expectedCommandVersion:
            context.expectedCommandVersion,
          outbox:
            context.outbox
        });

      return structuredClone(
        committed.checkpoint
      );
    } catch (error) {
      if (
        error instanceof
        RecoveryFinalizationConflictError
      ) {
        throw new RecoveryTransitionCommitConflictError(
          error.entity,
          error.message
        );
      }

      throw error;
    }
  }

  private assertContext(
    prepared: PreparedRecoveryTransition,
    context: SQLiteRecoveryCommitContext
  ): void {
    const runId =
      prepared.nextCheckpoint.runId;

    if (context.control.runId !== runId) {
      throw new Error(
        `Recovery control belongs to ${context.control.runId}, expected ${runId}`
      );
    }

    if (context.command.runId !== runId) {
      throw new Error(
        `Recovery command belongs to ${context.command.runId}, expected ${runId}`
      );
    }

    for (const event of context.outbox) {
      if (event.runId !== runId) {
        throw new Error(
          `Recovery outbox event ${event.id} belongs to ${event.runId}, expected ${runId}`
        );
      }

      if (
        event.commandId !==
        context.command.commandId
      ) {
        throw new Error(
          `Recovery outbox event ${event.id} belongs to command ${event.commandId}, expected ${context.command.commandId}`
        );
      }
    }
  }
}
