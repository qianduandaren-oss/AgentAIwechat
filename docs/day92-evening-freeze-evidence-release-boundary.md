# Day 92 晚练｜冻结 Inventory 之后，为什么发布仍 NO_GO

日期：2026-11-21；Week 14 / Day 92；18:00。延续早课规范化 SHA-256 与午练 `SQLiteDay92InventoryFreezeStore` 的 immutable freeze/CAS。

## 工程改动

新增 `reviewDay92FrozenCutoverBoundary()`，只读审查当前冻结记录状态、版号、摘要、snapshotId/revision 与时间窗，再复用 Day 91 `reviewDay91EvidenceChain()` 对 30 项来源任务做拒绝发布的原因整理。**这个函数无论全部字段如何匹配，都永远 HOLD 且 `publishAuthorized=false`**。它不创建挑战、不签收 Host 事实、也不执行真实发布。

## 负向验证

```bash
npm ci
npm run test:recovery-writer-inventory-freeze-cas
npm run test:recovery-writer-inventory-freeze-release-boundary
```

一次性 SQLite 夹具运行以下检查：

- 两主机、双阶段七项 = 28 个 Host 证据槽；Inventory + Host + Consumer ACK = 30 来源任务；即使冻结记录精确匹配，也无认证来源
- source revision 漂移通过 Day 91 provenance 拒绝
- SQL 事务 `BEGIN IMMEDIATE` 中发生修改后 `ROLLBACK`，原始记录保留；关闭并重开数据库仍可读
- 直写 `manifest_json` 而不更新 digest 时被检测；**同时直写内容和摘要仍存在攻击面**
- CAS 作废会保存 version=2、state=invalidated；旧 attempt 本应不可复活
- 故意以直接 SQL 恢复 `state=frozen,version=1`，测试结果证明：若评审者保留 version=2 的独立参照，可发现版本倒退；**若攻击者也控制参照版本，旧快照能重新看似一致**

## 限制和上线门禁

测试不使用生产数据库、真实主机/namespace、认证部署 Inventory、签名 Host 证据或真实 Consumer ACK。存储的 Manifest 与摘要在同一 SQLite 中，旧 FD/直写 SQL 可绕过所有 CAS。后续必须引入独立受信的单调版本水位/不可回滚审计锚点，消除旧进程数据库写能力，锁定部署全集，才有讨论生产 GO 的条件；目前 NO_GO。

下一课 Day 93 继续研究外部单调锚点与信任边界，不重复今天的 SQLite 单库故障实验。
