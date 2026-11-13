# Day 84 早课｜策略撤销必须与 Writer 事务有共同线性化点

日期：2026-11-13（北京时间）｜08:00｜15～25 分钟。

## 从 Day 83 的 TOCTOU 继续

Day 83 晚练的 `RecoveryWriterDurableTrustAdmissionGate` 在委派前分别读取 Store 与受信 Source。它能拒绝*已经发生*的策略漂移，但从最后一次读到 SQLite 提交仍存在窗口。对 Outbox **claim** 和 **acknowledge** 都必须防止过时的 Controller 操作。

## 本次最低架构要求

- **同一个 SQLite 主数据库、同一个物理事务、同一个 DatabaseSync 连接**：`BEGIN IMMEDIATE` → 读取 `recovery_writer_trust_watermarks` 当前 `deploymentId/revision/digest` → 与服务端已认证的 activeWatermark 比较 → 原有 Writer Epoch / Lease / Version CAS → `COMMIT`。拒绝则 `ROLLBACK`。
- 策略更新也必须在**相同 SQLite 文件的竞争写事务**中推进版本；SQLite writer-lock 序列化后可得到清晰顺序。不能从另一文件或另一连接预读一下就称为原子围栏。
- 同版本不同 digest 必须拒绝；缺失水位、错误部署、存储失败都 Fail Closed。检查对象由受信 bootstrap 固定，不允许 RPC 提交版本、DB 路径或摘要。
- Claim 与 ACK 都接检查；已有外部副作用不会因撤权自动撤销，Consumer Inbox 幂等仍独立重要。
- Day 83 的异步来源验证与 Admission 检查保留为外围防线，不能替代事务中的数据库水位检查。
- 仍需单一 Writer OS 权限、旧 FD/WAL/SHM 隔离、真实 Consumer ACK、策略签发、跨主机权威协调；生产 **NO_GO**。

### 实施分工

Day 84 早课只引入 `assertRecoveryWriterTrustMatch()` 的**纯比较合同和负向测试**，不更改旧的 `SQLiteFencedOutboxDelivery` 行为。午练才给实际 claim/ack 事务接入同连接读取与围栏，并验证双连接竞争；晚练做故障注入及 Week 12 总结。

> 纯比较函数无法检测是否真的位于事务中；即便测试通过，也不是写入安全的证明。
