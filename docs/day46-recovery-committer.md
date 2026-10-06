# Day 46 午练：RecoveryTransitionCommitter

早课已经把 Recovery 拆成 **Prepare / Commit** 两段。午练继续把现有 `CheckpointRecoveryCoordinator` 接到这个边界上。

## 目标

Coordinator 不再自己拼下一状态后直接调用 `checkpointStore.save()`，而是：

```text
load checkpoint
↓
prepareRecoveryTransition()
↓
PreparedRecoveryTransition
↓
RecoveryTransitionCommitter.commit()
```

默认实现仍然使用 `CheckpointStore.save()`，因此旧行为保持不变；但 Commit 已经成为可替换策略，后续可以接 Day 45 的 SQLite Unit of Work。

## 新增 Contract

```ts
export interface RecoveryTransitionCommitter {
  commit(
    prepared: PreparedRecoveryTransition
  ): Promise<AgentRunCheckpoint>;
}
```

默认 Adapter：

```text
CheckpointStoreRecoveryTransitionCommitter
↓
checkpointStore.save(
  prepared.nextCheckpoint,
  prepared.expectedCheckpointVersion
)
```

## 为什么要保留 expectedVersion

Prepared Transition 只是基于旧事实算出的候选状态。

如果 Commit 时版本已经变化：

```text
prepare on v7
↓
another worker commits v8
↓
commit(expectedVersion = 7)
↓
CheckpointConflictError
↓
reload + prepare again
```

不能把旧 Prepared Transition 的版本改成 8 再硬写。

## 本次边界

这一步只把 Coordinator 从“固定使用 CheckpointStore 提交”改成“依赖 Committer”。

真正的 Transaction-aware Committer 还需要同时拿到：

- Recovery Control
- Durable Command
- Outbox Event

因此下一步才会把 Day 45 的 `SQLiteRecoveryFinalizationUnitOfWork` 接进来。
