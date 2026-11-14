# Day 85 午练｜严格隔离 Writer Factory：Bootstrap → 同库水位验证 → 事务操作

日期：2026-11-14；状态：隔离候选测试，生产 NO_GO。

## 为什么需要这一步

Day 85 早课的 `reviewRecoveryWriterCreationBoundary()` 是纯审查合同，不负责创建 Writer。Day 84 的 `SQLiteFencedOutboxDelivery(path)` 为兼容旧测试仍允许不带水位构造，易被生产启动代码误用。

本节新增 `createIsolatedTrustBoundRecoveryWriter()`，强制从已存在的 Day 83 `bootstrapRecoveredWriterTrust()` 获取活动水位。它不会接受 JSON 请求传来的 watermark，不允许生产意图，不允许跳过锚点/策略 Source，不在水位错误时返回 Writer。

```text
服务端预置的 Trust Store + 真实已认证的策略 Source
   -> bootstrapRecoveredWriterTrust(): source 字节摘要 + revision/CAS + 有效期
   -> reviewRecoveryWriterCreationBoundary(): isolated_candidate + matching watermark
   -> new SQLiteFencedOutboxDelivery(dbPath,{activeTrustWatermark})
   -> writer.assertTrustBoundForIsolatedStartup(): 在自身 SQLite 连接、写事务核对
   -> 只暴露已验证的隔离候选 Writer；Claim/ACK/Rotate 每次继续事务内重查
```

## 运行

```bash
npm ci
npm run test:recovery-writer-trust-bound-factory
npm run test:recovery-writer-creation-boundary
npm run test:recovery-writer-trust-tx-evening
```

新测试使用临时 SQLite + 受信 Source 桩，覆盖：无预置锚点、生产意图、不合法路径、Writer DB 与 Trust Store 不一致、新旧版本切换、Source 断连、摘要损坏、旧 Writer Rotate 禁止、当前 Writer 的 Rotate/Claim/ACK、精确重启。

## 不可忽视的限制

- Factory 仍是普通 JS 函数；任意代码仍可直接调用历史构造函数或打开可写 SQLite 连接。Day 84 负向测试已证实这个旁路；本节没有修复 OS 隔离或旧 FD。
- Source 的可信真实性仍来自注入的服务端适配器：测试仅用桩，不是生产签发/认证方案；持久 Store 应与同一 DB/同一安全域绑定。
- 初始化期间审查不是完整的生命周期线性化协议，进程外可在 Factory 返回后撤权；每个写事务必须继续用 Day 84 同库 Trust Fence。
- 没有生产 Worker 唯一身份、SQLite/WAL/SHM 权限隔离、真实 Consumer ACK、跨节点策略传播或热更新协调证据；`publishAuthorized=false`，**NO_GO**。
