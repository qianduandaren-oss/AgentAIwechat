# Day 68 晚练｜Recovery Ingress 发布前安全边界复核

日期：2026-10-28（Asia/Shanghai）

## 接续 Day 68 早课和午练

早课已引入 `RecoveryIngressGate`，对可信 Principal、请求结构、Run 租户及操作权限进行前置校验。午练引入 `handleRecoveryIngressResponse` 和真实 SQLite 故障回归：未授权时零 Admission，已终态 replay 在授权撤销后不得泄露 ResultSnapshot。

今晚新增 `day68-evening-ingress-contract-test.ts`，检查响应安全、旧 Preflight Owner Guard 的错误码、当前权限对历史 replay 的约束与没有触发执行器的拒绝路径。并修复旧 Owner Guard 抛 `RecoveryEntryOwnershipConflictError` 时原先误映射成 500 的问题，现统一返回 409 `RECOVERY_CONFLICT`。

## 受测安全合同

- 验证当前授权后才能重放终态；响应中的 Snapshot 为克隆值
- 已撤销权限、Run 跨租户、Principal 缺失或客户端注入 `requestedBy`/`tenantId`，均不得进入 Executor
- 已记录的执行 Owner 冲突映射成 409，不向外泄漏 commandId 等内部详情
- terminal 缺 Snapshot → 503；executing → 202；数据库等未知异常 → 脱敏 500
- 非法 operation 在业务执行前 400
- 回归测试使用最小 Executor Spy 来核对零调用；真实 SQLite 写入与重放由 Day 68 午练的 13 项集成测试继续覆盖

## 真实发布审查：当前为什么仍 NO_GO

| 约束 | 当前证据与缺口 |
| --- | --- |
| 实际 HTTP/CLI Recovery 入口 | `http-adapter.ts` 当前仅暴露普通 Agent Run 的 `handleAgentRun`；没有生产 Recovery API |
| 可信认证 | `RecoveryIngressGate` 只接收已认证 Principal；未实现 JWT/Session/mTLS 验证 |
| 资源授权权威 | `findTenantId` 和 `canOperate` 仍为可注入接口，真实租户 / Run ACL 权威未接线 |
| 原子性 | Shared Claim 防止同 commandId 双路由竞争；授权决定与 Claim 不在同一一致性事务内，仍可能发生撤权或 Run 租户迁移 TOCTOU |
| 旧路径隔离 | `DurableRecoveryOperationOrchestrator.execute()` 和旧 `RecoveryOperationService.execute()` 仍可独立调用，候选入口门禁不能封锁所有旁路 |
| Legacy 最终态写入 | 旧 Control 写入与 Command terminal CAS 可能分离；不能声称全局 exactly-once |
| 故障注入 | 已有进程内 SQLite 多连接故障测试；正式入口 E2E、多进程重启、真实身份撤权竞态尚待验证 |
| Feature Flag | 当前生产不应开启 Atomic Recovery；不能以绿色单元测试替代流量切换评审 |

## 回归指令

```bash
npm ci
npm run test:recovery-ingress-evening
npm run test:recovery-ingress-sqlite
npm run test:shared-recovery-claim
npm run test:recovery-run-level-cas
```

## Day 69 的起点

优先明确真实 HTTP/CLI Recovery 入口的认证中间件与 Principal 可信来源，避免任何直接调用旧 Orchestrator 的旁路。再研究如何把 Run 租户归属 / ACL 版本（授权证据）与 Shared Claim 的认领一致性关联。今天不通过虚构的 `releaseReady=true` 配置绕开这些实质缺口。

**发布裁决：NO_GO。**
