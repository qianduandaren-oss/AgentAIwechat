# Day 40 Evening · Crash → Restart → Recover

Day 40 晚练把前几天的模块串成完整 Crash Recovery 链路：

```text
Persist Intent
↓
External Tool succeeds
↓
Process Crash
↓
Restart
↓
load persistent checkpoint
↓
RecoveryPlanner
↓
Reconciler
↓
confirm actual outcome
↓
CAS save
↓
resume
```

最典型的场景是：

```text
execute_refund
outcome = started
```

不能解释成“退款没有执行”。

可能发生过：

```text
退款成功
↓
Persist Outcome 前 Crash
```

因此恢复顺序必须是：

```text
started
↓
reconcile
↓
executed
↓
skip
```

而不是直接 Retry。

并发恢复时：

```text
Worker A save succeeds
↓
Worker B CheckpointConflictError
↓
Worker B reloads
↓
discovers executed
↓
skip
```

这保证恢复流程不会因为重复任务投递而重复制造业务副作用。
