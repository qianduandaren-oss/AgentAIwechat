# Day 66 晚练：持久化路由所有权与 Feature Flag 翻转保护

日期：2026-10-26（Asia/Shanghai）

## 上下文与目标

Day 66 早课实现 `RecoveryEntryDispatcher`，午练在真实 SQLite 中验证了 COMMIT 丢响应、Admission 后异常等故障。
晚练补上一个不容易被普通测试发现的缺口：一条命令在 Atomic 路由被认领后，即使部署重启、Feature Flag 变成 OFF，也不能把同一 `commandId` 交给旧 Orchestrator 作为第二个 terminal writer。

## 本次代码变更

- `DurableRecoveryCommandRecord.executionOwner?: "legacy" | "atomic_control_only"`：兼容旧 JSON；缺省是 **unknown**，不能推断成任一拥有者。
- Atomic 的 SQLite Admission 将 `executionOwner: "atomic_control_only"` 与 `accepted v1 → executing v2` 一起持久化，后续 terminal 快照保留该标记。
- 旧 `DurableRecoveryOperationOrchestrator` 的新 Admission 写入 `executionOwner: "legacy"`；历史记录不被补写或伪造。
- `RecoveryEntryDispatcher` 可注入 `RecoveryEntryOwnershipReader`。守卫先读共享 Command 事实，使用 `decideDurableRecoveryOperation` 校验不可变请求身份，随后比较配置选择与已持久化的 owner。owner 不一致或历史未知 → **fail closed**；数据库读取异常 → 传播，不兜底。前两个参数的旧用法暂时兼容，旧调用方**不自动获得此保护**。

### 安全边界

这次做的是 **read-only preflight guard**，不是生产级的所有权原子预留。两种路由都必须读取同一份 Command 持久化事实，否则不能成立；当数据库中已有旧无标记命令时，不能不经审查地重新归属。

此外，`loadCommand()` 与下一步 legacy admission 之间有 TOCTOU 窗口：另一个进程可能在前置读取完成后认领同一个 commandId。生产级门禁需要把**两个路线的 Admission 和路由所有权校验**统一放进共享持久化的事务/CAS 边界，并让正式 HTTP/CLI 入口强制使用它。现有生产入口尚未接入 Dispatcher，本次不得开启切换开关。

## 回归与验收

复用主工程真实 SQLite 集成测试，而不是新增孤立 Demo：

```bash
npm ci
npm run test:recovery-entry-sqlite-fault
npm run test:atomic-control-only
npm run test:durable-recovery-operation
```

`src/demos/day66-recovery-entry-sqlite-fault-test.ts` 由 6 个案例扩充到 11 个，包括：

1. Atomic 已 terminal，Flag OFF → 禁止 Legacy，Flag ON → durable replay。
2. Atomic executing v2 遇到授权异常，Flag OFF → 禁止把 in-flight 给 Legacy。
3. 历史 owner 缺省 → Flag OFF/ON 都 fail closed，不自造来源。
4. 显式 legacy owner → 仅允许 OFF，ON 不能抢执行权。
5. 改动 `reason` → 路由决策前先触发不可变身份冲突。

原来的 6 项真实 SQLite 故障场景保持不变。CI 工作流继续运行 `npm run test:recovery-entry-sqlite-fault`，覆盖新增案例。

## 发布检查点（NO_GO）

- [x] 新入库命令携带执行路由所有权，不伪造历史 JSON。
- [x] 候选 Dispatcher 支持持久化读取与 fail-closed 守卫。
- [x] 测试覆盖 Flag 翻转、in-flight、终态重放、无 owner 记录、请求身份冲突（结果以 CI 为准）。
- [ ] 正式入口的统一鉴权、租户隔离与运维审计。
- [ ] 新旧路由**共享 Admission** 的事务性所有权保护（消除 TOCTOU）。
- [ ] 多进程/重启/反向翻转下的 E2E 故障注入、工具副作用幂等恢复。
- [ ] 真实入口的唯一 terminal writer 审查及带 SHA 的发布批准。

**结论：结构与候选保护已实现；未接正式入口、未做跨路由原子 claim，Atomic Recovery Cutover 仍 NO_GO。**
