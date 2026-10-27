# Day 67 晚练｜Run-level CAS 与 Claim-required Ingress 验收

日期：2026-10-27（Asia/Shanghai）。本篇基于早课共享 Claim 契约、午练同库 Legacy/Atomic 认领实现继续演进；不替换或删除旧路由。

## 为什么一个 commandId 只执行一次还不够

共享 Claim 的唯一键是 `commandId`。两条不同的命令可能都成功认领 `executing v2`，同时引用同一个 Run 的 `expectedControlVersion=0`。只能在执行时通过 Finalizer 的同事务 Control CAS，阻止第二条过期命令修改状态。失败命令会保持 `executing v2`，不能改写成“已失败”冒充完成，也不能自动让 Legacy 重新执行。

## 候选组合层新增限制

`src/runtime/recovery-claim-required-entry.ts` 提供 `ClaimRequiredRecoveryEntry`。构造时要求注入共享 `SharedRecoveryOwnershipClaimer`，以及 Legacy/Atomic 两个 `executeClaimed` Handler。缺任何一项抛 `RecoveryClaimRequiredError`，阻止配置不完整的候选入口回退到旧的 preflight-only 分支。

这是一条 **候选入口约束**，不是正式 HTTP/CLI 路由；原有 `RecoveryEntryDispatcher` 和直接调用 `execute()` 的旧代码依然可用，因此并未全局消除绕过风险。

部署组合根仍需确保 Claimer 与 `asLegacyCommandStore()`、Atomic Finalizer 使用**同一数据库权威**。接口类型本身不能验证数据库连接位置、事务语义或后端租户权限。

## 同库真实 SQLite 回归

代码：`src/demos/day67-evening-run-level-cas-test.ts`。
命令：`npm run test:recovery-run-level-cas`。

七项断言：
1. 缺少共享 Claimer 的候选入口构造失败，且没有写入。
2. Legacy Handler 不支持 `executeClaimed` 时失败，不使用旧 `execute()` 兜底。
3. Atomic Handler 不支持 `executeClaimed` 时失败。
4. 不同 commandId、相同 Run、相同 expected Control v0，A 先提交；B 在 Finalizer Control CAS 冲突，B 仍是 executing v2，Outbox 只有 1 条。
5. 交换提交顺序，B 先提交，A 同样不能过期提交。
6. 使用新 commandId、`expectedControlVersion=1` 的 `release_quarantine` 可以在之前的 `quarantine` 后合法成功：Control v2、两条 Outbox。
7. Atomic 终态后重放，再将 Flag 从 ON 切至 OFF，同一 commandId 仍拒绝 Legacy 抢走归属，授权次数和 Outbox 条数不增加。

验证的边界是**共享 Claim + Finalizer 版本控制**，不是不同 Command 的串行化或端到端 exactly-once（尤其不涵盖外部工具副作用）。

## 上线阻塞项（NO_GO）

- 原有 Orchestrator / Service 的直接入口仍能绕过这层候选组合；旧 Service 的 Control 持久化不在 Finalizer 事务内。
- 正式 HTTP/CLI 入口尚未接线。应在任何 Admission 前验证请求身份、操作者权限、租户与 Run 所属关系，拒绝缺少幂等 commandId / expected versions 的请求；不能把仅有 `requestedBy` 字符串当作身份认证。
- `executing v2` 的冲突/超时处理需要证据读取、工单、可审计的恢复决策，不允许直接重试业务。
- 必须测试多进程重启、Flag 翻转、COMMIT 丢响应、Outbox 投递重复/失败以及跨容器连接同一个真正共享的权威存储。
- 生产发布开关与回滚策略需保证已认领 Command 保持原 owner，不能把 `NO_GO` 误解为“切回 Legacy 就安全”。
- 不把 CI 绿灯解释成正式线上流量已接入：CI 只证明受测 commit 的测试执行结果。

## 下一段路线

Day 68 应先审计真实入口与直接调用点，为迁移建立明确的唯一接入 API、身份/租户校验契约，并准备 in-flight 冲突证据的可观测输出。未消除绕过和旧写入边界前不启用 Atomic Recovery。
