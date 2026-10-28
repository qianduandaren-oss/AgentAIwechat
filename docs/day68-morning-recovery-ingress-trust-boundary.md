# Day 68 早课｜Recovery Ingress Trust Boundary：先鉴权，再认领

日期：2026-10-28（Asia/Shanghai）。承接 Day 67 的 `ClaimRequiredRecoveryEntry`、共享 SQLite Claim 和 Run-level CAS。本次新增的是候选入口前的安全边界，并没有新增生产 HTTP/CLI 路由，也没有更改旧 `RecoveryOperationService`。

## 仓库实际入口审计

- `src/runtime/http-adapter.ts` 仅导出普通 Agent Run 的 `handleAgentRun()`；没有 Recovery Command 专用路由。
- `src/runtime/production-runtime.ts` 面向 Agent Run；不能把 Run 的鉴权等同于 Recovery 管理操作鉴权。
- `src/runtime/recovery-entry-dispatcher.ts` 有可选共享 Claimer 和旧的无 Claimer 路由；生产入口不能选择可绕过 Claim 的构造方式。
- `src/runtime/recovery-claim-required-entry.ts` 已强制候选入口提供共享 Claimer，但它接收的 `DurableRecoveryOperationCommand.requestedBy` 仍是字符串，不能证明身份已由服务端认证。
- `src/runtime/durable-recovery-operation-orchestrator.ts` 的 `execute()` 和 `src/runtime/recovery-operations.ts` 的 `execute()` 仍可被直接调用，无法宣布所有 Recovery 操作都通过统一入口。

## 新增候选安全边界

文件 `src/runtime/recovery-ingress-gate.ts` 提供 `RecoveryIngressGate` 和严格的 `parseRecoveryIngressRequest()`。它不接受来自 JSON 的 `requestedBy` / `tenantId`，拒绝未识别字段，要求明确的非负整数 Checkpoint / Control 版本。依次检查：

1. 上游已经认证的 `AuthenticatedRecoveryPrincipal`（本模块本身不验证 JWT、Session 或 mTLS）。
2. 请求字段的形状、操作白名单、长度及版本。
3. `RecoveryIngressRunDirectory.findTenantId(runId)` 确认 Run 属于此租户；不存在与跨租户一律对外返回 `NOT_FOUND`。
4. `RecoveryIngressPermissionPolicy.canOperate(principal,operation)` 确认当前操作权限。
5. 从 `principal.actorId` 派生不可变 `requestedBy`，才调用配置好的候选 Claim-required executor。

任何步骤失败都不能触发共享 Claim、旧 Handler、Control 写入或 Tool call。候选 Gate 的执行器类型虽为结构化接口，生产组合根仍必须注入 `ClaimRequiredRecoveryEntry`；不能只依赖 TS 结构类型证明这一点。

## 运行测试

```bash
npm ci
npm run build
node dist/demos/day68-recovery-ingress-gate-test.js
```

测试覆盖成功路径，以及无 principal、空 actorId、伪造 requestedBy/tenantId、缺失 Control 版本、未知操作、跨租户/不存在 Run、权限拒绝；在受拒场景里执行器调用次数必须保持不变。

## 尚未解决的生产阻塞项（NO_GO）

- 外部认证中间件、真正 HTTP/CLI 路由、HTTP 状态码与错误响应格式没有实现；不能相信任意请求头或 JSON 构造的 principal。
- 租户/Run 权威查询和操作权限系统尚未接入实际业务库；查询和 Claim 间仍可能发生权限撤销或 Run 迁移，需定义失效策略与重校验；必要时在同权威事务里绑定租户/Run。
- 当前 `commandId` 全局唯一，不能以它替代租户隔离或 Row-level authorization；终态 replay 之前必须先完成身份和 Run 权限校验。
- 门禁尚未强制覆盖旧的公开 `execute()` 调用点，也没有负向权限审计或生产安全日志。
- Legacy 的 Control 更新与 terminal CAS 仍分开，不能宣布端到端 atomic / exactly-once；没有多进程、反向代理、故障注入的真实入口验收。

Day 68 午练：把拒绝结果映射为明确响应契约，在真正可测的应用入口边界内验证“校验失败时零 Admission/零审计泄漏”和“终态 replay 也要重新鉴权”，并开始梳理绕过入口的导出调用点。Feature Flag 保持关闭。
