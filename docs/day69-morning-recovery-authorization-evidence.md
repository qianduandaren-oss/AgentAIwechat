# Day 69 早课｜ACL Revision Evidence 与共享 Claim 的一致性边界

日期：2026-10-29（Asia/Shanghai）

## 承接 Day 68

Day 68 已有候选 `RecoveryIngressGate` 和 `handleRecoveryIngressResponse`，在 Shared Claim 前校验可信 Principal、Run 租户归属与操作权限，并对终态 replay 重新鉴权。它们尚未绑定生产 HTTP/CLI、认证服务或真实 Run/ACL 权威。

重要缺口：读取租户与权限 → 异步 await → Shared Claim BEGIN IMMEDIATE，两个步骤之间可能被撤权或迁移 Run。

## 课程主题：带版本的授权证据，而不是鉴权结果缓存

拟引入（未集成）如下三种权威版本：

- `runTenantRevision`：Run→Tenant 归属变更时递增；
- `runAclRevision`：Run ACL 改动时递增；
- `actorGrantRevision`：操作者角色、授权、禁用改动时递增。

版本由服务端可信权威提供，不能让客户端填写或使用 `Date.now()` 伪装成版本。证据还要绑定 `actorId + tenantId + runId + operation`。

```text
HTTP/CLI 可信身份（未接线）
  → RecoveryIngressGate 查询授权权威，生成证据 E@revision
  → [可能撤权/Run迁移/授权变化]
  → 未来 claimAuthorized() 必须在同一事务内：
       比较当前三种版本、校验仍授权、Run 仍属于租户
       然后 Shared Claim accepted→executing
       版本变化或无法原子检查 → 拒绝，无 Admission
```

### 最容易误判的点

**第二次 SELECT 不等于消除 TOCTOU。** 若 ACL 在另一个数据库/服务里，SQLite 的 `BEGIN IMMEDIATE` 只锁它自己的库，无法阻止远程权限系统在事务过程中撤权。实际可行方案包括：把权威授权快照/版本与 Claim 放在同一事务数据库；或严格设计跨系统 fencing/失效同步（仍需明确延迟和失败策略）。本课没有声称已经选定或实现某种生产方案。

### 目前真正写入的代码

- `src/runtime/recovery-authorization-evidence.ts`：Evidence、revision、Authority、`TransactionalAuthorizedRecoveryClaimer` 接口；身份与版本不变式的纯校验函数。
- `src/demos/day69-morning-authorization-evidence-test.ts`：10 项纯契约检查，覆盖身份串用、无证据、版本非法和 3 种版本漂移。
- 没有修改 `RecoveryIngressGate` 或 `SQLiteRecoveryFinalizationUnitOfWork.claim()` 的生产行为，也没有接入第三方认证。

### 需要审查的旧入口旁路

- `src/runtime/http-adapter.ts` 只处理普通 Agent Run，未有生产 Recovery API。
- `DurableRecoveryOperationOrchestrator.execute()` 仍支持绕过共享 Claimer 的独立执行路径。
- `RecoveryOperationService.execute()` 仍可能先改业务 Control，再与 terminal CAS 分离。
- 生产层的身份认证服务与 Run 归属/ACL 权威尚未接线。

## 12:00 午练的实现目标

设计一个可测试的版本化授权权威 fixture，演示“授权通过→撤权/迁移→Claim 前拒绝且零写入”。然后审查能否将版本校验放入与 Command Claim 相同的 SQLite 事务（注意同库边界），不能用纯 preflight 冒充原子化保证。

本课仍是候选架构和纯契约测试，**发布裁决 NO_GO**。
