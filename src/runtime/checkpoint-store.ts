import type { AgentRunCheckpoint } from "./checkpoint.js";

export class CheckpointConflictError extends Error {
  constructor(
    public readonly runId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Checkpoint conflict for ${runId}: expected version ${expectedVersion}, actual version ${actualVersion}`
    );
    this.name = "CheckpointConflictError";
  }
}

export interface CheckpointStore {
  load(runId: string): Promise<AgentRunCheckpoint | undefined>;

  save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint>;
}

function cloneCheckpoint(checkpoint: AgentRunCheckpoint): AgentRunCheckpoint {
  return structuredClone(checkpoint);
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, AgentRunCheckpoint>();

  async load(runId: string): Promise<AgentRunCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(runId);
    return checkpoint ? cloneCheckpoint(checkpoint) : undefined;
  }

  async save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint> {
    const current = this.checkpoints.get(checkpoint.runId);
    const actualVersion = current?.version ?? 0;

    if (actualVersion !== expectedVersion) {
      throw new CheckpointConflictError(
        checkpoint.runId,
        expectedVersion,
        actualVersion
      );
    }

    const saved: AgentRunCheckpoint = {
      ...cloneCheckpoint(checkpoint),
      version: actualVersion + 1,
      updatedAt: new Date().toISOString()
    };

    this.checkpoints.set(saved.runId, cloneCheckpoint(saved));
    return cloneCheckpoint(saved);
  }
}
