# Day 84 午练：把信任版本检查放进 Claim / ACK 的 SQLite 写事务

日期：2026-11-13 · Week 12 / Day 84

## 目标

Day 83 的 RPC Admission 在委派前读取 Trust Watermark，但检查结束到 Outbox 提交之间存在 TOCTOU。Day 84 在已有 `SQLiteFencedOutboxDelivery` 的 `BEGIN IMMEDIATE` 事务内，使用**同一个 `DatabaseSync` 连接**读取 `recovery_writer_trust_watermarks` 并调用 Day 84 早课的 `assertRecoveryWriterTrustMatch`。只有 revision、digest、deploymentId 与受信启动快照完全一致，才继续 Writer Epoch / Lease / Outbox Version CAS。

## 接入

```typescript
// activeWatermark 必须取自 Day 83 bootstrap 的受信返回值，不来自 RPC JSON。
// path 必须与 SQLiteRecoveryWriterTrustWatermarkStore 使用完全相同的数据库文件。
const store = new SQLiteFencedOutboxDelivery(path, {
  activeTrustWatermark: activeWatermark
});
// trusted SingleWriterCandidateService 持有并调用 store；客户端从未控制水位。
```

- `claim()` 与 `acknowledge()` 都从原本的事务入口调用 `assertTrustInTransaction()`，再检查 Writer Epoch、Lease 和 Outbox CAS。
- 缺水位行、不同 deploymentId、旧 revision、同版不同 digest 或无信任表会 **抛错并 ROLLBACK**，调用方候选服务转成 `hold`。
- 若旧 Claim 的事务先于撤权 CAS 提交，属于撤权前完成；若撤权 CAS 先提交，旧 Claim/ACK 后续事务被拒绝。
- 为避免破坏 Day 78–83 的既有测试，**不传 activeTrustWatermark 仍保留历史候选模式**。它是不带信任事务围栏的 legacy 路径，不可作为生产配置。

## 运行

```bash
npm ci
npm run test:recovery-writer-trust-tx-sqlite
npm run test:recovery-fenced-outbox
npm run test:recovery-single-writer-candidate
```

新测试使用同一临时文件的两个 SQLite 连接，验证撤权前 Claim 成功、撤权后旧 ACK 与 Claim 被拒、失败事务未改变 Outbox、同库新策略可以正常 Claim/ACK、异摘要/错部署/无信任表 Fail Closed。

## 明确的不足

这只证明**经由带参数配置的 `SQLiteFencedOutboxDelivery`** 的数据库更新被围栏。直接打开 SQLite 的遗留 Writer 仍能执行任意 SQL；尚未进行生产环境 UID、目录/WAL/SHM、旧打开 FD、混合版本隔离验证。证书撤权的实时传播、受信策略签名/分发、真正 Consumer ACK、远端副作用和多节点共享强一致性依然没有生产证明。生产 **NO_GO**。

晚练将对崩溃、失联、混合版本旁路和可信切换做验证，并输出 Week 12 Checkpoint。
