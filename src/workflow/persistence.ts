import { clone } from "../shared/utils.js";
import type { WorkflowState } from "./types.js";

export interface WorkflowStateStore {
  save(state: WorkflowState): Promise<void>;
  load(requestId: string): Promise<WorkflowState | undefined>;
}

/**
 * 教学默认用内存持久层，让代码零依赖可运行。
 * 生产可替换成 Redis / Postgres，Runner 无需改动。
 */
export class MemoryWorkflowStateStore implements WorkflowStateStore {
  private readonly data = new Map<string, WorkflowState>();

  async save(state: WorkflowState): Promise<void> {
    this.data.set(state.requestId, clone(state));
  }

  async load(requestId: string): Promise<WorkflowState | undefined> {
    const value = this.data.get(requestId);
    return value ? clone(value) : undefined;
  }
}
