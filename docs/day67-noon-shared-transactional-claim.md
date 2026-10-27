# Day 67 午练｜Shared Transactional Ownership Claim

日期：2026-10-27（Asia/Shanghai）

## 为什么这是 Day 66 的真正修复

Day 66 的 RecoveryEntryDispatcher 只有只读 owner preflight，SELECT 和实际 INSERT/CAS 分离。两个进程可以在彼此的 admission 之前都读到“不存在”，这就是 TOCTOU。

现在候选路径的 `SQLiteRecoveryFinalizationUnitOfWork.claim(command, owner)` 在同一个 SQLite 文件、同一笔 `BEGIN IMMEDIATE` 事务中完成：

1. 基于 `commandId` 读取 Command，并复用现有 `decideDurableRecoveryOperation` 校验 runId、operation、requestedBy、reason 和两个预期版本。
2. 若已有记录，先核验 `executionOwner`；缺失也必须拒绝，不伪装成 legacy。terminal 只有携带 ResultSnapshot 才 replay，accepted/executing suspend。
3. 若不存在，则插入 `accepted v1`（带 owner），CAS 成 `executing v2` 后 COMMIT。
4. 只有 `claimed_executing` 才能进入对应业务执行器。新路径异常绝对不自动调用旧 Handler 兜底。

数据库事务在 CAS 后立即结束，不跨越异步授权或 Agent 执行。

## 候选接线

`RecoveryEntryDispatcher` 第四个可选参数为共享 Claimer，第三个参数仍为原先的只读 Owner Guard（旧调用方完全保留）。使用 Claimer 时，入口会在处理器运行之前执行共享 Claim，并调用：

- `AtomicRecoveryControlOnlyAdapter.executeClaimed(command, claim)`：跳过 Atomic 原来的 `admitControlOnlyCommand()`，直接进入纯 Prepare + Selective Finalizer。
- `DurableRecoveryOperationOrchestrator.executeClaimed(command, claim)`：跳过旧 `insertIfAbsent / accepted→executing`，在同库 `RecoveryCommandStore` 上继续原有业务执行与 terminal CAS。
- `SQLiteRecoveryFinalizationUnitOfWork.asLegacyCommandStore()`：提供同库 Legacy Command Store 候选适配器，且其更新限制为 legacy owner 的合法 CAS 状态迁移。

此时“共享 Claim + 两个认领后的处理器”才是候选新入口。直接调用旧的 `execute()` 或 Atomic 的普通 `execute(command, true)` **不会自动得到这些保护**。

## 真实 SQLite 验收矩阵

命令：`npm run test:shared-recovery-claim`

代码：`src/demos/day67-shared-ownership-claim-test.ts`

1. 两个 SQLite 连接同 owner 并发，只能有一次 claimed；另一个 suspend。
2. Legacy 先认领后，Atomic 无法夺权。
3. Atomic 先认领后，Legacy 无法夺权。
4. 同一 commandId、reason 改变，触发完整身份冲突。
5. 历史 owner 缺失，双方都拒绝猜测。
6. 已终态但 ResultSnapshot 缺失，拒绝重做。
7. Dispatcher → Shared Claim → Atomic → Finalizer，terminal v3，重试 replay，Outbox 恰一条。
8. Dispatcher → Shared Claim → Legacy → 同库 Command terminal CAS，终态 v3，重试 replay。
9. Atomic COMMIT 后模拟丢响应，重试仅 replay。
10. Legacy/Atomic 并发抢同一 commandId，只有一个业务写入者胜出。

配套 CI：`.github/workflows/runtime-tests.yml` 新增 Day 67 检查步骤。CI 状态应以提交 SHA 对应的 GitHub Actions 结果为准；没有 PASS 证据时不宣布已验证。

## 仍然 NO_GO

- 共享 Claimer 还只是 opt-in 的进程内组合层，并未绑定生产 HTTP/CLI Recovery 入口；非共享的旧调用仍存在。
- Legacy 的业务状态写入仍独立于 terminal CAS（`RecoveryOperationService` 可在 Command terminal 之前 `controlStore.save()`），并非真正与 Outbox 一次原子 Finalization。
- Claim 解决了相同 commandId 的跨路由 TOCTOU，但不能凭 Command 行证明不同 commandId 对同一 Run 的业务并发安全。
- 真实入口的鉴权/租户隔离、重启恢复、异步故障注入和 feature-flag 灰度机制仍未完成。
- 不把同一个 SQLite 连接误认为跨容器部署共享的全局权威；生产需确认所有参与者连接到同一受支持的数据库。
