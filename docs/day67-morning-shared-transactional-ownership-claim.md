# Day 67 早课｜Shared Transactional Ownership Claim：把选路和认领收进同一笔事务

日期：2026-10-27（Asia/Shanghai）

## 前置事实与最新证据

- Day 66 晚练新增 `executionOwner`、Dispatcher 的可选只读 OwnershipReader，真实 SQLite 11 场景覆盖 Flag 翻转。
- 运行前 main HEAD：`da309915fb35cfd5a56d0f44587e40b08b36e62f`。对应 Runtime Tests Run `40304938999` 已完成 success；Build、Day 66 SQLite 故障回归及旧 Orchestrator 回归均为 success。此结果只覆盖该 SHA。
- 源码确认：`RecoveryEntryDispatcher.execute()` 先 `loadCommand` 后调用 Handler；它存在 TOCTOU。Atomic `admitControlOnlyCommand()` 用 `BEGIN IMMEDIATE` 检查身份并认领，但仅覆盖 Atomic；旧 `DurableRecoveryOperationOrchestrator.acceptAndExecute()` 仍通过独立的 `RecoveryCommandStore.insertIfAbsent/updateIfVersion` 认领。仓库里没有可直接替代两者的共享 SQLite Claim 实现。
- `SQLiteRecoveryFinalizationUnitOfWork.commit()` 当前检查 Command 身份与 executing 状态，但没有把持久化 `executionOwner` 一同放进 terminal CAS 的所有权判定。后续必须补齐。

## 本日单一概念：Ownership Claim 的线性化点

不能用 Flag 和单次只读 SELECT 判断永久归属。两个 Worker 都可以观察到不存在，然后分别选中不同 Handler。唯一安全的判定点必须是**共享持久化的事务性 Claim**：

~~~text
入口（身份认证、操作权限和租户绑定仍需正式接线）
  捕获配置候选 owner: legacy / atomic_control_only
                         ↓
               Shared Command Claim
                BEGIN IMMEDIATE
                  SELECT command_id
                  ├─ existing:
                  │   完整请求身份校验 + executionOwner 校验
                  │   unknown / mismatch → fail closed
                  │   terminal + Snapshot → replay
                  │   accepted/executing → suspend
                  └─ absent:
                      INSERT accepted(owner, v1)
                      CAS accepted v1 → executing v2
                COMMIT
                         ↓
       只有 claimed_executing 才进入所选 Handler
       任何异常不跨路由 fallback
~~~

**边界注意**：共享的是同一物理 SQLite 文件及其 `recovery_commands` 表，不是“两个数据库都有一个同名表”。`BEGIN IMMEDIATE` 释放后，后续运行仍靠 Command 的版本、身份、owner 和终态约束，而非持有数据库锁等待外部工具。

### API 草案

新增 `src/runtime/recovery-shared-ownership-claim.ts`，只定义 `SharedRecoveryOwnershipClaimer.claim(command, owner)` 与三种结果：`claimed_executing`、`suspend_in_flight`、`replayed_terminal`。**这是 TypeScript 可编译的接口契约，不是 SQLite 实现，也没有接到正式入口。**

~~~ts
const result = await claimer.claim(command, "atomic_control_only");
switch (result.action) {
  case "claimed_executing":
    // 此时才允许本路由的业务处理；不得再次执行独立 Admission。
    break;
  case "suspend_in_flight":
    // 只读诊断、人工核对，不自动执行。
    break;
  case "replayed_terminal":
    // 必须已校验完整身份并有持久化 Snapshot。
    break;
}
~~~

上面 `claimer` 是下一次练习实现的接口实例；此处只展示消费合同，不是即刻可执行的示例。

## 工程集成的两处硬约束

1. **旧链路不能原封不动地套在共享 Claim 后面**：它仍会自行 `insertIfAbsent`，并可能在事务外保存 Control、二次 terminal CAS。必须显式改成“已认领的 Command”执行路径，或让同一个持久化 CommandStore 承担两条路由 Admission，并分别验证写入者。
2. **Atomic Adapter 也不能重复 Admission**：如果共享 Claim 已产生 executing v2，它再调用 `admitControlOnlyCommand()` 会把请求识别为 in-flight 并暂停。需要专门的 claim-aware 执行方法，不可为了走通而跳过身份和版本校验。

## 午练验收方案（尚未完成）

真实 SQLite **两个连接、一个文件**做竞争，断言仅一个 `claimed_executing`；另一个同 owner → suspend，另一个不同 owner → conflict；身份变化 → conflict；历史 owner 缺失 → fail closed；终态有 Snapshot → replay，无 Snapshot → error；回滚不留下 accepted 半记录。再检查 Finalizer terminal CAS 是否验证 owner、旧 Service 是否仍会产生写入。正式入口还必须补鉴权、租户边界、E2E 故障注入与可观察告警。

## 发布门禁

- [x] Day 66 带 owner 的命令、只读预检与 11 场景基线，已在 HEAD `da309915` 的 CI 通过。
- [x] Day 67 Shared Claim 接口契约与本篇架构笔记。
- [ ] 两种路由共享事务 Claim 的 SQLite 实现和并发/重启回归。
- [ ] 与 Claim 配套的 Legacy/Atomic 已认领执行路径及 Finalizer owner 验证。
- [ ] 正式 HTTP/CLI 鉴权、租户隔离与同一 SHA 的 E2E 发布批准。

结论：**NO_GO**。不要把编译通过的接口当作可生产切换的原子所有权实现。
