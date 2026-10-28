# Day 68 午练｜Ingress 安全响应与 SQLite 零 Admission / Replay 再授权

日期：2026-10-28（Asia/Shanghai）。承接当天早课的 `RecoveryIngressGate` 与 Day 67 的 `ClaimRequiredRecoveryEntry`、SQLite 共享 Ownership Claim。

## 本次真实变更

- 修复 Day 68 早课测试的 CI 类型断裂：项目没有 `@types/node`，不能直接在测试导入 `node:assert`。改为已有工程风格的本地断言工具，没有引入额外依赖。
- 新增 `src/runtime/recovery-ingress-response.ts`：无网络监听的响应契约映射。403/404 拒绝不会携带 Run 身份或持久化结果；500 不返回内部错误消息。
- 新增 `src/demos/day68-noon-ingress-sqlite-test.ts`：真实 SQLite Checkpoint、共享 Command Claim、Atomic Adapter、Ingress Gate 串接。非授权输入不能进入 Claim；已终态的命令必须再次通过当前权限才能拿到 ResultSnapshot。
- 入口的 `202 IN_FLIGHT` 表示不确定持久化中间状态，应调查；不是自动重试许可。
- `409 RECOVERY_CONFLICT` 适用于不可变请求身份、Owner 和 CAS 冲突。实际向外发布前仍需确认这组错误语义适合业务平台。

## 响应契约（框架无关，不是正式 HTTP 服务）

| 情况 | status | body.code |
| --- | --- | --- |
| 认证成功 + 首次执行 / 重放 | 200 | OK |
| 命令 accepted/executing | 202 | IN_FLIGHT |
| 请求字段或不支持的操作 | 400 | BAD_REQUEST / UNSUPPORTED_OPERATION |
| 无受信 Principal | 401 | UNAUTHENTICATED |
| 操作权限不足或已撤权 | 403 | FORBIDDEN |
| Run 不存在或属于别的租户 | 404 | NOT_FOUND |
| 不可变请求身份 / Owner / CAS 不一致 | 409 | RECOVERY_CONFLICT |
| 终态结果缺失 | 503 | TERMINAL_SNAPSHOT_UNAVAILABLE |
| 未归类的错误 / 可能已 COMMIT 的回复异常 | 500 | RECOVERY_UNAVAILABLE |

安全响应不返回原始异常信息。调用方不能看到 500 后回退到 Legacy 或生成新 commandId 重试。

## 关键验证

```bash
npm ci
npm run test:recovery-ingress-sqlite
node dist/demos/day68-recovery-ingress-gate-test.js
npm run test:shared-recovery-claim
```

受测场景包括：伪造 requestedBy、缺 Principal、错误版本类型、跨租户/不存在的 Run、撤权、首次持久化成功、再次授权后的 ResultSnapshot replay、撤权后的 replay 拒绝、改 actor/reason 的身份冲突、被拒绝操作以及 in-flight 202。拒绝时 Command/Control/Outbox 不应发生新写入；成功重放不应二次授权业务 Adapter 或写出第二条 Outbox。

## 仍然 NO_GO

这只是进程内可信 Principal 注入 + 安全响应映射，没有验证 JWT、Session 或 mTLS，也没有正式 HTTP/CLI Recovery 路由。RunDirectory 和 PermissionPolicy 仍为测试实现；权限撤销与 Claim 间存在可能的 TOCTOU；同一个 actor 的会话级身份认证与会话撤销要在 HTTP 层解决。旧 RecoveryOperationService 的直接写入仍可绕过入口，Legacy 的状态和 Command 终态尚未合入同一事务。

Day 68 晚练应集中检查安全测试的 CI 结果、外部认证与审计要求，以及从旧入口安全迁移的发布门禁。不应将这一候选层误称为生产级 API。
