# Day 39 · Checkpoint Conflict Recovery

Day 39 的核心不是“发现冲突”，而是冲突以后如何安全继续。

## 核心链路

```text
load checkpoint
↓
plan recovery
↓
reconcile / retry / skip / suspend
↓
CAS save
↓
CheckpointConflictError
↓
reload
↓
re-plan
```

关键原则：

> Conflict 以后不要重试旧决定，而要基于最新 Runtime Fact 重新做决定。

`CheckpointRecoveryCoordinator` 负责协调：

- `CheckpointStore`
- `RecoveryPlanner`
- `ReconcilerRegistry`
- CAS Conflict

它不直接执行退款、发消息、创建订单等业务 Tool。

## 为什么不能只改 expectedVersion

旧的 `nextCheckpoint` 是基于旧版本状态计算出来的。其他 Worker 可能已经更新 Tool Outcome、Resume Boundary 或完成 Reconciliation。

所以错误做法：

```text
Conflict
↓
expectedVersion 改成最新版本
↓
重写旧 payload
```

正确做法：

```text
Conflict
↓
load latest
↓
重新解释 checkpoint
↓
重新 Recovery Planning
```

对应测试：

```text
src/demos/checkpoint-recovery-coordinator-test.ts
```
