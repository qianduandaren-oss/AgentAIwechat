import { clone } from "../shared/utils.js";
/**
 * 教学默认用内存持久层，让代码零依赖可运行。
 * 生产可替换成 Redis / Postgres，Runner 无需改动。
 */
export class MemoryWorkflowStateStore {
    data = new Map();
    async save(state) {
        this.data.set(state.requestId, clone(state));
    }
    async load(requestId) {
        const value = this.data.get(requestId);
        return value ? clone(value) : undefined;
    }
}
