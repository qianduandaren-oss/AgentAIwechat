# Day 81 午练｜RPC JSON 白名单 + 逐操作授权（候选服务边界）

日期：2026-11-10（Asia/Shanghai）｜Week 12 / Day 81。

## 承接

早课只定义了 `RecoveryWriterWireRequest`、`VerifiedTransportCaller` 与 Handler 接口。午练新增 `RecoveryWriterRpcCandidateHandler`，复用 Day 79 `RecoverySingleWriterCandidateService` 与 Day 78 `SQLiteFencedOutboxDelivery`，不另建一个 Runtime。

## 请求约束

- 只接受原始 JSON 文本。传入任意 JS 对象、无法解析的 JSON、超出 16 KiB 的正文，一律 `hold`；调用者可由传输适配器将已限制体积的 UTF-8 请求体传入，**不可把未认证的 Header 变为调用身份**。
- 仅允许 `claim_outbox`、`confirm_outbox`，按操作精确枚举顶层字段。额外字段（`epoch`、`ownerId`、`dbPath`、`caller` 等）一律拒绝。
- `requestId` 最多 128 个 ASCII 字符，`outboxId` / `eventId` 最多 256，`leaseToken` 最多 512；拒绝空值和异常格式，避免过度信任 TS 类型。
- `VerifiedTransportCaller` 只能由**真正认证成功的传输适配层**注入。当前测试使用可信身份模拟对象，**不等于**已验证真实 Unix socket peer credentials / mTLS。
- 授权在执行服务端逻辑之前进行：调用身份必须被允许使用对应操作；没有权限时不会触发消费者 ACK Adapter。
- `rawConsumerResponse` 必须交给 Day 79 服务端 ACK Adapter 验证；RPC Handler 不直接宣称 ACK 真实，更不会接受客户端自报的 Writer Epoch。

## 测试

```bash
npm ci
npm run test:recovery-writer-rpc
```

`src/demos/day81-noon-writer-rpc-test.ts` 使用临时 SQLite 验证：缺失身份、错误操作、额外字段、过大请求、不合法 ID、仅 Claim 授权、伪造 ACK、受信 Adapter 放行后的 Fenced ACK。所有负例要求 Outbox 不被提前设置为 `dispatched`。

## 未完成的真实生产安全边界

本次仅编写**候选进程内 Handler**，没有实现真正的 RPC/IPC Listener、peer credentials、mTLS、传输层身份注入、部署隔离、速率限制、请求重放保护、审计采集和真实消费者密码学签名。测试中的模拟 ACK 验证器只用于回归。OS 单一写入权（Day 80）仍需在实际部署环境阻断旧 Worker 直接 SQL。生产 **NO_GO**。

晚练继续处理请求重放、取消/超时、授权撤销和审计的失败路径。
