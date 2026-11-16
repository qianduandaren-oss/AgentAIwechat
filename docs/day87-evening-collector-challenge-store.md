# Day 87 晚练：SQLite 一次性 Challenge、旧报告重放与签名 Key 撤销

日期：2026-11-16。建立在 Day 87 早课 `reviewSignedWriterCollectorArtifact()` 和午练真实 `/proc` 原始字节实验之上。**只供隔离候选训练；生产 NO_GO。**

## 为什么必须持久化消费

原本 Ed25519 验签是纯函数：同一份有效原始字节、签名和 challenge，只要五分钟内再次提交仍会通过。今天把由控制面随机签发的 challenge 持久化在 SQLite，并用 `BEGIN IMMEDIATE` 使“检查是否已消费”与“记录已消费”共享写入锁。同一数据库的另一个连接无法复用已消费记录。崩溃重启后依然保持已消费状态。

## 数据流

```text
pre-provision keyId → pinned public key (实验管理 API)
    ↓ 独立控制面生成 192-bit random challenge
challenge record (deploymentId, releaseId, host, namespace, observer, keyId, TTL)
    ↓ 采集器对原始观测摘要及以上 claims 作 Ed25519 签名
verifyAndConsume() BEGIN IMMEDIATE
    ├─ 核实 issued / 未过期 / key 未撤销
    ├─ 使用持久 Store 预置公钥执行 Day87 早课验签
    ├─ 核实调用方目标与记录目标一致
    └─ CAS 写成 consumed + artifact digest
COMMIT → ready_for_isolated_single_use_review / publishAuthorized=false
```

密钥撤销和 challenge 消费均竞争同一个 SQLite 写锁。如果撤销先提交，旧签名不再通过；如果消费先提交，该结果最多是**隔离候选**，不意味着生产授权，且后续复用仍被拒绝。不同 keyId 可用于轮换，老 keyId 不可重新绑定新 PEM 或从 revoked 状态恢复。

## 验收

```bash
npm ci
npm run test:recovery-writer-collector-attestation
npm run test:recovery-writer-signed-host-fd-probe
npm run test:recovery-writer-collector-challenge-store
```

本次自动回归覆盖：签名或原文被篡改且未消费、错误 host、未经签发、过期、重复消费、第二连接复用、数据库重开后的重放、旧密钥撤销后的旧报告、轮换到新密钥、禁止生产请求。失败按 HOLD，不会自动补发同 nonce。

## 必须保持的生产边界

- `provisionLabTrustedKey`、`issueChallenge` 和 `revokeTrustedKey` 目前是本地数据库 API：还没有鉴权控制面，不能暴露给 Worker 或未授权调用者。
- SQLite 文件与 WAL/SHM 的写权限需要由独立部署身份隔离，否则旧进程可直接改表清除消费/撤销记录；本实验没有消除 Day 80/85 的绕过风险。
- 签名只证明持有对应私钥的一方签了数据，不保证 /proc 观测是真实、完整或生产范围内的报告。
- 仅实现了同一 SQLite 数据库上的原子消费，并非跨数据库/跨集群的共识或“发布决策 + 挑战消费”的分布式事务。
- 当前 consumer ACK、生产主机 FD/namespace/挂载隔离、控制面密钥发放与签发记录审计仍缺证据。无论测试是否 PASS，生产持续 **NO_GO**。
