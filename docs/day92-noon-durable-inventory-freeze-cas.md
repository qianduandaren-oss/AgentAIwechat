# Day 92 午练｜只读候选来源 + 持久冻结与 SQLite CAS（隔离实验）

日期：2026-11-21，Week 14 / Day 92，12:00。**生产 NO_GO**。

Day 92 早课的 `planDay92InventoryFreezeCandidate()` 已经对 Day 91 Inventory 候选进行严格匹配与稳定散列；本次把候选指纹落入与现有 Recovery Runtime 一致的 Node.js `node:sqlite`。这仍然不是生产受信 Inventory：注入的 `Day92IsolatedInventorySource` 是内存测试实现，不代表身份认证的部署平台，也不能根据 `trusted: true` 或某个类名授予权力。

## 入口与唯一写入点

```text
isolated test composition root
  -> pre-pinned scope (deployment/release/attempt/hosts) + anchor
  -> injected readSnapshot(binding) [fixture; not authenticated]
  -> Day 91 strict review + Day 92 canonical SHA-256
  -> SQLiteDay92InventoryFreezeStore.freezeOnce()
        BEGIN IMMEDIATE
          empty attempt -> INSERT frozen(version=1)
          same bytes -> exact_replay
          other bytes/revision -> conflict
          invalidated attempt -> denied
        COMMIT
  -> action=hold / publishAuthorized=false
```

`freezeOnce` 通过 SQLite 同一主键 `(deployment_id,release_id,attempt_id)` 原子插入，完整规范化 manifest JSON 和摘要同库保存；读取时核对摘要。一个 attempt 的冻结清单**不允许原地更新**：同版换内容、改时限、回滚 revision 都不能悄悄覆盖已冻结版本。

`invalidate(binding, { version, manifestSha256 })` 持有 `BEGIN IMMEDIATE` 锁核对版本与摘要，成功后将状态改为 invalidated，版本 +1。旧版本或错误摘要冲突；同一个 attempt 永远不可重新冻结。变更部署全集必须新建 attempt，重新取得权威清单与所有主机/ACK 证据。

## 本次测试

```bash
npm ci
npm run test:recovery-writer-inventory-freeze
npm run test:recovery-writer-inventory-freeze-cas
```

`day92-noon-inventory-freeze-store-test.ts` 使用两个 SQLite 连接及一次性目录，验证：

- 缺失/错误来源不得写入；production_release 固定 HOLD
- 两连接首次冻结与准确重放；摘要和完整 manifest 跨关闭/重开仍可读
- snapshotId/revision 或主机范围漂移、同 attempt 不同时间字段导致冲突
- 旧版本/错误摘要无法 invalidation；有效 CAS 后禁止同 attempt 复活
- 新 attempt 可独立冻结；`publishAuthorized=false`

## 实际安全边界

**SQLite CAS 只防通过这个写入路径发生的竞态，不是 OS 写权限隔离。** Day 88–89 已证明旧 Store 或直接 SQL 仍可绕过控制面。完整 manifest 与摘要存放在同一可写数据库，攻击者如果都能改写，仍可伪造一致的两份数据；此实验也没有加受信签名、外部不可篡改锚点、真实部署源、PID/FD 清场或 Consumer ACK。

下一步 Day 92 晚练继续做故障注入、相同 attempt 不同源并发、崩溃重启与危险回滚负例；不会把实验 PASS 当成生产 GO。
