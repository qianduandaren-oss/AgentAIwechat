import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import type { AgentRunCheckpoint } from "./checkpoint.js";
import {
  CheckpointConflictError,
  type CheckpointStore
} from "./checkpoint-store.js";

interface FileCheckpointState {
  checkpoints: Record<string, AgentRunCheckpoint>;
}

function cloneCheckpoint(
  checkpoint: AgentRunCheckpoint
): AgentRunCheckpoint {
  return structuredClone(checkpoint);
}

function parentDirectory(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return undefined;
  return normalized.slice(0, index);
}

/**
 * Learning/local prototype only.
 *
 * This store survives process restart, but its CAS guarantee is only serialized
 * across FileCheckpointStore instances in the same Node.js process. Separate
 * processes can still race on the same file. Day 41 moves CAS into the shared
 * transactional storage layer.
 */
export class FileCheckpointStore implements CheckpointStore {
  private static readonly queues =
    new Map<string, Promise<void>>();

  constructor(
    private readonly filePath: string
  ) {}

  async load(
    runId: string
  ): Promise<AgentRunCheckpoint | undefined> {
    return this.withFileLock(async () => {
      const state = await this.readState();
      const checkpoint = state.checkpoints[runId];
      return checkpoint
        ? cloneCheckpoint(checkpoint)
        : undefined;
    });
  }

  async save(
    checkpoint: AgentRunCheckpoint,
    expectedVersion: number
  ): Promise<AgentRunCheckpoint> {
    return this.withFileLock(async () => {
      const state = await this.readState();
      const current = state.checkpoints[checkpoint.runId];
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

      state.checkpoints[saved.runId] =
        cloneCheckpoint(saved);

      await this.writeState(state);
      return cloneCheckpoint(saved);
    });
  }

  private async readState(): Promise<FileCheckpointState> {
    try {
      const raw = await readFile(
        this.filePath,
        "utf8"
      );

      const parsed =
        JSON.parse(raw) as FileCheckpointState;

      return {
        checkpoints:
          parsed.checkpoints ?? {}
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return { checkpoints: {} };
      }

      throw error;
    }
  }

  private async writeState(
    state: FileCheckpointState
  ): Promise<void> {
    const directory =
      parentDirectory(this.filePath);

    if (directory) {
      await mkdir(directory, {
        recursive: true
      });
    }

    const temporaryPath =
      `${this.filePath}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2),
      "utf8"
    );

    await rename(
      temporaryPath,
      this.filePath
    );
  }

  private async withFileLock<T>(
    task: () => Promise<T>
  ): Promise<T> {
    const previous =
      FileCheckpointStore.queues.get(
        this.filePath
      ) ?? Promise.resolve();

    let release!: () => void;
    const done =
      new Promise<void>(resolve => {
        release = resolve;
      });

    const queued =
      previous.then(() => done);

    FileCheckpointStore.queues.set(
      this.filePath,
      queued
    );

    await previous;

    try {
      return await task();
    } finally {
      release();

      if (
        FileCheckpointStore.queues.get(
          this.filePath
        ) === queued
      ) {
        FileCheckpointStore.queues.delete(
          this.filePath
        );
      }
    }
  }
}
