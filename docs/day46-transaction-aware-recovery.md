# Day 46 Morning · Transaction-aware Recovery Orchestrator

Day 45 已经把 Checkpoint、Recovery Control、Durable Command 和 Outbox 放进同一个 SQLite Unit of Work。

Day 46 开始处理新的架构问题：现有 `CheckpointRecoveryCoordinator` 仍然同时承担“决定下一状态”和“立即保存 Checkpoint”两个职责。这样外层的 Recovery Command 很难把所有状态变化统一纳入一个事务。

本阶段先把恢复流程拆成两个明确阶段：

```text
Prepare
↓
读取当前 Checkpoint
运行 RecoveryPlanner / Reconciler
计算 nextCheckpoint
保留 expectedCheckpointVersion
不做持久化

Commit
↓
校验 expected versions
Checkpoint / Control / Command / Outbox
一次事务提交
```

新增 `src/runtime/recovery-preparation.ts`，提供 `prepareRecoveryTransition()` 和 `PreparedRecoveryTransition`。

当前 Morning 版本只建立“persistence-free preparation”边界，并通过测试确认：

- 输入 Checkpoint 不被修改；
- Prepare 不递增版本；
- Prepare 返回 `expectedCheckpointVersion`；
- Reconciliation 可以参与决策，但不会自行 Commit；
- completed Run 不制造多余写入。

下一步会把现有 Coordinator 和 RecoveryOperationService 逐步接到这个 Prepare / Commit 边界上，避免重新实现一套 Recovery Policy。
