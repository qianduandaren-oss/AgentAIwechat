# Day 64 午练｜Selective SQLite Recovery Finalizer（候选能力，未切流）

日期：2026-10-24（Asia/Shanghai）

## 背景

Day 63 的兼容层已合入，Day 64 早课已把 GitHub Actions 证据与具体 commit 绑定。
旧 `SQLiteRecoveryFinalizationUnitOfWork.commit()` 不区分读依赖和写集合，每次都会将 Checkpoint 与 Control 的版本都加一。Control-only 的 quarantine 不应该修改 Checkpoint。

## 本次改动

- `src/runtime/recovery-write-set.ts`：纯函数 `planRecoveryWriteSet()` 根据准备后的实际变化生成 `compare | cas_update`，禁止 rejected/no-op 伪造变更，禁止 Control-only 修改 Checkpoint。
- `src/runtime/sqlite-recovery-finalization.ts`：`RecoveryFinalizationInput.writeSet?` 可选。旧调用方未传时保留原有“两行均更新”的语义；明确传入 Write Set 时，对 compare 状态只在同一 `BEGIN IMMEDIATE` 事务里核对版本，不更新行；对 cas_update 执行有条件 UPDATE/INSERT。
- 同一事务还校验 persisted command 是 `executing`、版本与不可变请求身份一致，校验 Outbox 的 `commandId/runId`；完成必要状态更新、Command terminal CAS 与 Outbox 插入。
- `src/demos/day64-selective-recovery-finalizer-test.ts`：真实 SQLite 集成回归，包括 Control-only、版本漂移、Outbox UNIQUE 回滚、compare 空 Control、旧调用方兼容、身份串单、Outbox 串单、Checkpoint-only、重复终态。

## 实际验证

- GitHub Actions commit：`72a1425d623aad91244a12a686477c1563b00501`
- Runtime Tests：`40060920641`（completed / success）
- 已核对工作流中 Build、原 SQLite UoW 回归、Day 64 selective SQLite integration、Orchestrator 回归步骤均为 success。
- 链接：https://github.com/qianduandaren-oss/AgentAIwechat/actions/runs/40060920641

复现：

```bash
npm ci
npm run build
npm run test:recovery-unit-of-work
npm run test:selective-recovery-unit-of-work
npm run test:durable-recovery-operation
```

## 仍为 NO_GO 的阻塞

1. 正式 Recovery 路由未向新 Finalizer 传入基于真实 Prepare 结果的 Write Set。
2. `RecoveryOperationService.execute()` 仍可能在事务外提前持久化 Control 或调用 Coordinator 变更 Checkpoint。
3. `DurableRecoveryOperationOrchestrator` 仍会在旧 Service 执行后再次写 Command terminal。
4. 尚无正式入口级断连、COMMIT 丢回复、外部工具幂等与 Outbox 派发故障注入的验收证据。
5. 当前 compare Control 不存在时返回 v0 派生默认对象，不意味着数据库已建立 Control 记录。

**结论：候选 Finalizer 已进入 main 且 CI 覆盖其 9 项 SQLite 集成场景；并没有切换生产/正式原子 Recovery 路由。**
