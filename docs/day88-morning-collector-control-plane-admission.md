# Day 88 早课：Challenge 控制面身份、授权与审计边界

日期：2026-11-17。基于 Day 87 已实现的 Ed25519 签名与 SQLite 单次 Challenge 消费，梳理谁能签发、轮换和撤销。

## 风险链路

签名和一次性消费解决报告被篡改/重放，却没有限制谁可以调用 `provisionLabTrustedKey()`、`issueChallenge()`、`revokeTrustedKey()`。如果 Worker 仍持有数据库写权限，甚至可以绕过这些方法直接操作 SQLite。这意味着 **Challenge 正确 ≠ 控制面安全**。

## 拟议的分层设计

```text
已认证 mTLS 控制面入口（认证真实 Peer，而非信任请求 JSON）
  → 可信 principalId + role + deploymentId + releaseId + ACL
  → reviewCollectorControlPlaneCommand() 纯策略审查
  → 不可省略的持久审计 / requestId 去重（Day 88 午练起实现）
  → 受限 Challenge Store 管理 API
  → 单库 BEGIN IMMEDIATE 的签名验证与一次性消费
```

新 `reviewCollectorControlPlaneCommand()` 拒绝 runtime_worker/collector 操作管理入口。仅 `challenge_issuer` 可请求签发；`release_admin` 才能请求公钥预置、撤销。两者均受 release/deployment/显式操作授权约束，结果 **只可能进入隔离候选**。审查结果附带建议性的结构化 `audit` 对象，尚未持久化，也不能把它冒充真实审计日志。

## 运行

```bash
npm ci
npm run test:recovery-writer-control-plane-admission
```

覆盖缺失身份、伪造 actorId、跨部署/跨 release、越权角色、操作 ACL 缺失、错误 keyId、生产意图与管理员正确请求。`authenticatedPeer` **必须**由受信 mTLS 入站适配层构造：本模块不会验证证书，不能接受 RPC JSON 中自称已认证的 peer。持久审计、真实管理入口、Linux 旧 FD 排空、数据库与 WAL/SHM OS 隔离、回滚和 Consumer ACK 仍待验证，生产 **NO_GO**。
