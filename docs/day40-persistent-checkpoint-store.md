# Day 40 · Persistent Checkpoint Store

Day 39 已经有 Version + CAS，但 `InMemoryCheckpointStore` 仍然依赖 Node.js 进程内的 `Map`。

Day 40 的目标是让 Checkpoint 第一次离开进程内存。

## FileCheckpointStore

学习版实现：

```text
src/runtime/file-checkpoint-store.ts
```

它保持与现有 `CheckpointStore` 相同的接口：

```ts
load(runId)
save(checkpoint, expectedVersion)
```

并使用：

```text
temporary file
↓
write
↓
rename
```

降低写到一半留下半截 JSON 的风险。

## 重要边界

`FileCheckpointStore` 适合本地学习和 Restart Contract 验证，但它不是生产级多进程 CAS。

当前实现只在同一个 Node.js 进程内串行化同一路径的读写。两个完全独立的 Node 进程仍然可能同时读取旧版本并竞争写文件。

因此：

```text
File Persistence
≠
Distributed Atomic CAS
```

对应测试：

```text
src/demos/persistent-checkpoint-test.ts
```

测试同时验证：

- Store 实例重建后 Checkpoint 仍存在
- ToolExecutionRecord / Idempotency Key 可以恢复
- 同一进程两个 Store 实例的 stale write 被拒绝
