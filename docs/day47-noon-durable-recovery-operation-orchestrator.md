# Day 47 Noon · Durable Recovery Operation Orchestrator

Day 47 早课先固定了 command identity 与三种入口判断：

```text
不存在
→ accept_new

terminal
→ replay_terminal

accepted / executing
→ resume_in_flight
```

午练把这套判断真正接成可运行的 Orchestrator。

## 当前执行链

```text
DurableRecoveryOperationCommand
↓
load commandId
↓
decideDurableRecoveryOperation
↓
accept_new
  → insert accepted
  → CAS to executing
  → RecoveryOperationExecutor.execute
  → persist succeeded / rejected / failed
  → persist resultSnapshot

replay_terminal
  → return durable resultSnapshot
  → do not execute Recovery again

resume_in_flight
  → reload Checkpoint + Recovery Control
  → return current durable facts
  → do not blindly rerun handler
```

## Stable identity

同一个 commandId 绑定：

- runId
- operation
- requestedBy
- reason
- expectedCheckpointVersion
- expectedControlVersion

同 commandId 但 payload 不一致时抛出
`RecoveryCommandIdentityConflictError`。

## Stable terminal replay

Terminal 状态：

```text
succeeded
rejected
failed
```

其中 succeeded / rejected 会保存 `RecoveryCommandResultSnapshot`，用于重复请求时稳定重放：

```text
status
reason
checkpointVersion
controlVersion
```

重复请求不会再次进入 RecoveryOperationService。

## In-flight safety

如果已存在的 Command 是：

```text
accepted
executing
```

Orchestrator 当前不会直接再次调用 Recovery handler，而是重新读取：

```text
Checkpoint
+
Recovery Control
```

返回最新 durable facts。

这一版的目标是先把“不要盲目重跑”固定成 Contract。下一步再把 `resume_in_flight` 接到 Day 46 的 transaction-aware Recovery path，让它能基于整组 durable facts 安全恢复。

## Regression

新增：

```text
src/demos/durable-recovery-operation-orchestrator-test.ts
```

覆盖：

- 新 command 只执行一次
- terminal command 稳定 replay
- replay 不再次调用 Recovery executor
- rejected result 也能稳定 replay
- 相同 commandId + 不同 payload 触发 identity conflict
- accepted / executing command 重新读取事实，但不盲目重跑 handler
