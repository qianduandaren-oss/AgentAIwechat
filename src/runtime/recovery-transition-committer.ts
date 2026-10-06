import type { AgentRunCheckpoint } from "./checkpoint.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { PreparedRecoveryTransition } from "./recovery-preparation.js";

export class RecoveryTransitionCommitConflictError
  extends Error {

  constructor(
    public readonly entity: string,
    message?: string
  ) {
    super(
      message ??
        `Recovery transition commit conflict: ${entity}`
    );
    this.name =
      "RecoveryTransitionCommitConflictError";
  }
}

export interface RecoveryTransitionCommitter {
  commit(
    prepared: PreparedRecoveryTransition
  ): Promise<AgentRunCheckpoint>;
}

export class CheckpointStoreRecoveryTransitionCommitter
  implements RecoveryTransitionCommitter {

  constructor(
    private readonly checkpointStore: CheckpointStore
  ) {}

  async commit(
    prepared: PreparedRecoveryTransition
  ): Promise<AgentRunCheckpoint> {
    if (!prepared.shouldPersist) {
      return structuredClone(
        prepared.nextCheckpoint
      );
    }

    return this.checkpointStore.save(
      prepared.nextCheckpoint,
      prepared.expectedCheckpointVersion
    );
  }
}
