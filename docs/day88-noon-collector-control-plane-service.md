# Day 88 午练：受限控制面服务 + SQLite 原子审计

日期：2026-11-17（北京时间）。承接 Day 88 早课的 `reviewCollectorControlPlaneCommand()` 和 Day 87 的 `SQLiteWriterCollectorChallengeStore`。

## 目标与边界

这一轮不是给 Worker 提供一个自报 `role` 的新参数。由服务端隔离实验注入 `authenticatedPeer()`（模拟可信入口），外部请求只包含 operation、requestId 和操作参数，不接受来自 RPC JSON 的 `authenticatedPeer`。真实 mTLS、OS 身份隔离、数据库/WAL/SHM 权限以及 Legacy 入口下线仍未实现。

```text
隔离测试入口（host-owned resolver；不是生产 mTLS）
  -> IsolatedCollectorControlPlaneService.execute(request)
  -> Day 88 早课 Admission（role + ACL + deployment/release）
  -> Day 87 SQLiteWriterCollectorChallengeStore.executeAuditedControlCommand()
     BEGIN IMMEDIATE
       检查持久 requestId 是否已执行 / 错绑
       拒绝 => 写入 deny 审计
       允许 => 同库 provision / issue / revoke
                 + 写入 executed 审计
     COMMIT
  -> challengeId（仅 issuer 成功时）/ HOLD
```

## 重要的实现原则

1. 受限服务不把 `authenticatedPeer` 放在用户可提交的 Request 结构中；测试的 Resolver 与真实 TLS 已验证 Peer **不是一回事**。
2. 持久审计与管理变更处于同一 `BEGIN IMMEDIATE` 事务。若审计表无法写入，操作应整体回滚并返回 `control_audit_transaction_unavailable`。
3. 同 `deploymentId + releaseId + requestId` 的相同成功操作重试返回上一次结果，不重复创建 Challenge；不同 Payload 或操作者重用 ID 返回 `control_request_id_conflict`。已通过的请求也必须重新审查当前 ACL。
4. 审计仅保留操作与公钥摘要相关的请求指纹，不存私钥、Token 或原始公钥内容。
5. 当前审计表与信任表在同一 SQLite 文件，旧进程若拥有直接 SQL 写权限依然可绕过或篡改，**不能被认定为不可抵赖的生产审计**。

## 测试

```bash
npm ci
npm run test:recovery-writer-control-plane-admission
npm run test:recovery-writer-collector-challenge-store
npm run test:recovery-writer-control-plane-service
```

用临时 SQLite 与临时 Ed25519 密钥验证：未认证/Worker/ACL 缺失/跨 release 拒绝，管理员预置与撤销、Issuer 签发、重试幂等、改参冲突、Day 87 签名消费保持有效、进程重启后审计仍存在，以及审计表故障时变更原子回滚。

注意：旧的 `provisionLabTrustedKey()`、`issueChallenge()`、`revokeTrustedKey()` 依然公开用于旧实验。该服务仅强制**经过它的流量**；尚不能阻止旁路调用或直接 SQL。真实权限认证、可信审计导出、独立 OS 隔离与 Consumer ACK 未完成，生产 **NO_GO**。

## 后续

Day 88 晚练将针对旁路、混合权限、审计篡改和撤销竞争做负向验收，不将测试用 ACL、实验临时私钥与本地 SQLite 冒充生产可信源。
