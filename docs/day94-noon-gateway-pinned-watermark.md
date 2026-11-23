# Day 94 午练：Gateway 身份配置与已钉住的高水位（实验 NO_GO）

日期：2026-11-23（Asia/Shanghai）。承接 `docs/day94-morning-authenticated-audit-gateway-contract.md`。

## 信任边界

此前的 `reviewDay94AuditGatewayCandidate()` 只校验响应的随机 Challenge、发布绑定、时效、Ed25519 签名；它**不证明**当前最新审计头，不认证生产级网关身份。

本次增加：

- `Day94GatewayTrustPolicyReader`：由服务端装配读取预配置的 `expectedPeerId`、`pinnedPublicKeyPem`、其 SPKI SHA-256、冻结 `snapshotId/revision/manifestSha256`、最低 `checkpointSequence/eventSha256`。不能从网络响应自带字段导入配置。
- `Day94GatewayPinnedChannel.inspectPeer()`：隔离环境模拟从 TLS/IAM 已验身份上下文取得 `peerId`。本轮只用测试夹具，**boolean 本身不构成真实 TLS 认证**。真实接入必须用安全连接层生成该值，不允许请求正文声称。
- `reviewDay94PinnedGatewayWatermark()`：先检查本地政策与配置公钥指纹，再检查通道观察的 peer；调用 Day 94 早课现有验证器，最后检查已验签 checkpoint 与预钉住的最低水位。

## 检测顺序

```text
预配置策略 → 绑定匹配 + Ed25519 SPKI 指纹
          ↓
通道观察的 peer 身份（夹具）匹配
          ↓
Day94 早课随机 Challenge + 绑定 + Ed25519 验签
          ↓
snapshot/revision/manifest 相同？
          ↓
sequence < pinnedMinimum         → 拒绝倒退 / HOLD
sequence = pinnedMinimum, hash ≠ → 分叉/冲突 / HOLD
sequence > pinnedMinimum         → 需独立确认最新 head / HOLD
sequence = pinnedMinimum, hash = → 仍未证明外部不可回滚 / HOLD
```

所有分支 `action="hold"`、`authenticatedExternalAnchorCount=0`、`publishAuthorized=false`。**绝不能根据实验所填的 peerAuthenticated=true 或本地 SQLite 版本自行授予生产 GO。**

## 运行

```bash
npm ci
npm run test:recovery-writer-audit-gateway-contract
npm run test:recovery-writer-audit-gateway-pinned-watermark
```

测试包含真实临时 Ed25519 签名、被新 Challenge 重新签名的旧 sequence=1、同 sequence 异 hash、伪造 claimedPeerId、通道 peer 不匹配、错配公钥指纹、跨 attempt/配置丢失、production_release 拒绝。仅测试离线 TypeScript 代码；不接触真实网关和生产 DB。

## 下一步（Day 94 晚练）

把本模块与 Day 91–93 的 Release Blocker Register 联合审查。区分签名通过、传输 peer 身份、独立最新头、真正 OS/FD 采集、Consumer ACK 和生产权限。外部受信 mTLS/IAM、单调高水位保障、旧 FD 清场与真实 ACK 尚未验收，**生产 NO_GO**。
