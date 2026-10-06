# Day 46 晚练：Transaction-aware Recovery Orchestrator

日期：2026-10-06

Day 46 早课把 Recovery 拆成 `Prepare` 和 `Commit`，午练又把 `CheckpointRecoveryCoordinator` 的提交动作抽象成 `RecoveryTransitionCommitter`。

晚练继续把这个 Committer 接回 Day 45 的 SQLite Unit of Work。

## 目标

让一次需要持久化的 Recovery Transition 不再只写 Checkpoint，而是把：

```text
Checkpoint
+
Recovery Control
+
Durable Command
+
Outbox
```

放进同一个数据库事务。

## 新增桥接层

```text
src/runtime/sqlite-recovery-transition-committer.ts
```

它实现 `RecoveryTransitionCommitter`，但真正提交时调用 `SQLiteRecoveryFinalizationUnitOfWork`。

因此 Coordinator 仍然只认识 Committer Contract，不需要知道 SQLite 表结构。

## 当前调用链

```text
CheckpointRecoveryCoordinator
↓
prepareRecoveryTransition()
↓
PreparedRecoveryTransition
↓
SQLiteRecoveryTransitionCommitter
↓
SQLiteRecoveryFinalizationUnitOfWork
↓
BEGIN IMMEDIATE
↓
Checkpoint CAS
Control CAS
Command CAS
Outbox INSERT
↓
COMMIT / ROLLBACK
```

## 为什么 Commit Context 是 command-scoped

Checkpoint 的候选下一状态来自 Prepare。

但 Control、Durable Command 和 Outbox 都属于这一次 Human Recovery Command 的上下文，所以由 `SQLiteRecoveryCommitContextFactory` 在 Commit 时提供。

这样 Runtime Decision 和 Operation Context 没有重新揉回 Coordinator。

## 复合事务冲突和 checkpoint-only conflict 不一样

CheckpointStore Committer 发生 `CheckpointConflictError` 时，Coordinator 可以：

```text
reload checkpoint
↓
re-prepare
```

但 SQLite Unit of Work 的冲突可能发生在：

```text
checkpoint
control
command
outbox
```

如果是 control 或 command 已经过期，只重新加载 Checkpoint 明显不够。

因此 SQLite Committer 会把底层的：

```text
RecoveryFinalizationConflictError
```

转换成：

```text
RecoveryTransitionCommitConflictError
```

并让它离开 Coordinator 的 checkpoint-only retry loop。

更外层的 Human Recovery Orchestrator 应该重新加载整组事实，再重新判断整条操作。

## 本次回归测试

新增：

```text
src/demos/sqlite-recovery-transition-committer-test.ts
```

验证：

1. Coordinator 通过 SQLite Committer 完成恢复。
2. Reconciler 的 `executed` 结果进入 Checkpoint。
3. Checkpoint v1 → v2。
4. Control v0 → v1。
5. Durable Command `executing` → `succeeded`。
6. Audit / Recovery Event 先以 pending Outbox 落盘。
7. 关闭连接重新打开后，Checkpoint、Command、Outbox 仍然存在。

## 当前架构边界

现在已经完成：

```text
Prepare
↓
Committer Contract
↓
Transactional SQLite Committer
↓
Atomic Finalization
```

还没有完成的是完整的 command-aware `RecoveryOperationService`。

下一步需要继续解决：

- commandId 幂等入口；
- operation-level conflict reload / re-evaluate；
- terminal command replay；
- no-op / rejected command 的 durable result；
- Outbox Dispatcher 的持续投递。

