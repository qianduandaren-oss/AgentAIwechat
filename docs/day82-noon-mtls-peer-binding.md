# Day 82 午练｜真实 mTLS Peer → 可信 RPC Caller（隔离环境）

日期：2026-11-11（北京时间）；Week 12 / Day 82；12:00；15～25 分钟。

## 承接早课

Day 82 早课说明 `VerifiedTransportCaller` 必须来自真实的可信传输，不能由客户端 JSON 或 HTTP Header 构造。Day 81 已有严格 JSON parser、RPC Candidate Handler 和 Admission，再前面是 Day 79 SingleWriterCandidateService 与 Day 78 SQLite Fencing。

本次选择 **mTLS** 作为可直接使用 Node.js 标准库实现的真实传输实验。UDS 的 SO_PEERCRED 需要正确的 OS/原生适配器，不用自报 UID 假装实现身份验证。

## 代码归属

- `src/runtime/recovery-writer-mtls-transport.ts`：真实 Node `tls.createServer`、强制客户端证书、CA 链验证、SHA-256 指纹白名单映射、单行 JSON 消息传递。
- `src/types/day82-tls-builtins.d.ts`：仓库保持既有 minimal Node type shim 策略。
- `scripts/day82-noon-mtls-peer-lab.mjs`：临时生成 CA、服务端证书及 3 个客户端证书，用 localhost TLS 握手驱动 Day 81 Admission + Handler 测试；结束后销毁临时私钥/证书。

## 信任边界

1. 监听器强制 `requestCert: true`、`rejectUnauthorized: true`、TLS 1.3；实际 peer 来自 Node TLS 握手。未知 CA/无客户端证书不进入业务 Handler。
2. 服务端从 `getPeerCertificate().fingerprint256` 读取握手证书并精确匹配**本机配置**的指纹 → subject → grantedOperations；CA 签署但未注册的证书也被拒绝。
3. `rawConsumerResponse`、JSON `subject`、`epoch` 都不能构造调用身份；Day 81 Parser/ACL/Admission 仍二次把关。
4. 实验的 `service.confirmOutbox()` 是明确的**模拟 ACK**，不是生产签名验真。已存在的 Day 79 真实候选 Service 和 Day 78 SQLite 回归仍须独立保持通过。

## 运行

```bash
npm ci
npm run test:recovery-writer-mtls-peer
```

依赖 Node 22、OpenSSL，所有 key/cert 自动在临时目录生成和清理。不要在 GitHub 仓库放真实私钥，部署时必须由私密配置注入。

## 负向验收

- 无客户端证书 → TLS 拒绝；
- CA 签署但未在服务端注册的证书 → 指纹映射拒绝；
- Claim-only 证书请求 Confirm → 拒绝，ACK Handler 不执行；
- 客户端 JSON 加 `subject`/`epoch` → 严格白名单拒绝；
- 已认证且注册的 Caller 被服务端 ACL 撤销 → 拒绝；
- 消费者 ACK 未通过适配器 → 仍不能确认成功；
- 注册证书、合法操作、当前 ACL 与模拟 ACK 通过 → 测试 Stub 返回 dispatched。

## 未完成

本实验是**真实 localhost mTLS 握手**，并非生产 RPC 服务：尚未接入真实消费者签名校验和部署版 Day 79 Service；证书更新/撤销策略、协议消息长度限制的生产级测试、共享持久重放账本、旧进程/FD/DB 挂载隔离、WAL/SHM 和回滚验证都未完成。

因此生产发布始终 **NO_GO**。晚练将复盘证书失效、身份映射更新、授权撤销、审计与旧镜像回滚的边界。
