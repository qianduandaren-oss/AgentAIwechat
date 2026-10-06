import type { AgentRunCheckpoint } from "./checkpoint.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { PreparedRecoveryTransition } from "./recovery-preparation.js";

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
