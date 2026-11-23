# Day 94 晚练：Audit Gateway × 冻结 × 发布证据联合阻断（NO_GO）

日期：2026-11-23（Asia/Shanghai）｜Week 14 / Day 94 / 18:00。

本次承接 [Day 94 早课签名网关合同](day94-morning-authenticated-audit-gateway-contract.md)和[Day 94 午练身份钉住+最低水位](day94-noon-gateway-pinned-watermark.md)。不重复实现验签、SQLite CAS 或 Day 90 的 28 格覆盖率，而是把 Day 91–93 的发布阻断链与 Gateway 候选校验接在同一个只读入口。

## 模块与信任边界

`reviewDay94GatewayReleaseBoundary()`（`src/runtime/recovery-writer-audit-gateway-release-boundary.ts`）并行调用：

1. `reviewDay93AuditReleaseBoundary()`：Day 92 本地冻结、Day 93 候选审计、Day 91 Inventory/Host/Consumer 来源及发布阻断原因；
2. `reviewDay94PinnedGatewayWatermark()`：预配置（实验）Peer、公钥 SPKI 指纹、挑战、Ed25519 签名、最低高水位和分叉审查。

两者产生可解释的 `gatewayReason`、`auditReason`、`freezeReason`、`evidenceChainReasons`、`blockers`。发生 Adapter 抛错时也只返回 HOLD。对 `production_release` 直接拒绝，**不接触外部网关**。

## 不应该混淆的证据

| 候选事实 | 已验证的实验能力 | 仍缺失 |
| --- | --- | --- |
| Ed25519 + fresh Challenge | 请求绑定和所给 pin 的签名验算 | 受信生产公钥、Gateway mTLS/IAM |
| pinned minimum sequence | 被新 Challenge 重签的旧 head 仍可发现低于最低值 | 防回滚的外部 latest head 及受信策略持久化 |
| SQLite freeze + audit | 同域内事务、版本和单侧回滚负向实验 | 防双库+pin 一起回滚的独立高水位 |
| 28/28 Host PASS 元数据 | 目标/阶段覆盖率检查 | 真实独立 Linux OS/FD/PID/namespace 签名采集 |
| Consumer ACK 声称 authenticated | 字段、时间窗和 attempt 格式检查 | 实际对端认证、持久 Inbox/ACK、旧 raw ACK 入口关闭 |

**即使本地冻结、审计和 Gateway 都匹配、28 项合成 PASS 和伪造 ACK 全部齐全，`authenticatedEvidenceCount=0`、`publishAuthorized=false`。** Gateway 签名验证是局部事实，不提升整体证据的受信等级。

## 运行

```bash
npm ci
npm run test:recovery-writer-audit-gateway-contract
npm run test:recovery-writer-audit-gateway-pinned-watermark
npm run test:recovery-writer-audit-gateway-release-boundary
```

最后一个测试只创建两份临时 SQLite，运行时生成 Ed25519 夹具密钥，不接触生产或提交私钥。覆盖：

- 全部夹具看似一致，Host/Consumer 缺失：HOLD；
- 28 份合成 PASS + 自称认证 ACK：HOLD；
- sequence=1 的旧 head 以新 Challenge 重新签名，但独立候选 pin=2：ROLLBACK / HOLD；
- sequence 相同 eventHash 不同：FORK / HOLD；sequence 高于 pin：最新性未证 / HOLD；
- 签名错误、观察 Peer 错配、响应中伪造 claimedPeerId：HOLD；
- 审计 Reader 不可用、Inventory revision 漂移：各自 blocker 保留；
- production_release：直接 NO_GO，不调用 Gateway 网络接口。

## 下一阶段

Day 95 转向 **可信高水位推进与撤销策略的边界**：在候选签名验证后，仍不能让 Agent Worker 直接提升本地 pin；需独立服务授权、单调持久化、签发密钥轮换与撤销处理。今天的代码只增加审查和负向测试，不增加发布授权 API。

真实信任根、受信控制面、旧 FD 全量清场、Host Collector、Consumer ACK 和最新 head 仍未完成；生产 **NO_GO**。
