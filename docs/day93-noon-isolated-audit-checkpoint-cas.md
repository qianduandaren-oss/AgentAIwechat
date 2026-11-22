# Day 93 午练｜独立文件的 SQLite 单调水位实验（非生产认证）

日期：2026-11-22。承接 [Day 93 早课](day93-morning-monotonic-audit-anchor.md) 的只读 `Day93AuditAnchorReader`，本次实现 `SQLiteDay93AuditCheckpointStore`，**不是外部可信 Audit Service**。

## 为什么要有这个夹具

Day 92 的 Inventory SQLite 可被旧 Worker 的 SQL/FD 旁路回滚。Day 93 早课用注入的内存 checkpoint 展示本地 version 落后于锚点；午练改用**另一个 SQLite 文件**，验证多连接 CAS、追加序号、哈希链、关闭重启以及锁争用。文件路径分开不代表操作系统身份、权限、管理账号和备份恢复域分开。

## 合同与状态机

- 事件域标记：`agent-ai/recovery/audit-event/v1`；一条事件绑定 deployment/release/attempt、snapshotId/revision、manifest SHA-256、freezeVersion、state、checkpointSequence、采集和失效时间。
- 首项仅允许 `frozen(version=1, sequence=1)`；第二项仅允许同一摘要及快照的 `invalidated(version=2, sequence=2)`；再次追加/复活一律拒绝。
- 每一项存储 `previous_event_sha256` 和规范化 payload 的 `event_sha256`；读出**完整链**时重新计算，不能只检查最新一行。数据库 UPDATE/DELETE 触发器提供防误操作保护，但数据库拥有者可 DROP TRIGGER 并重新计算全链。
- `appendOnce(candidate, expectedHead)` 在 `BEGIN IMMEDIATE` 内读取并对照期望的 sequence + eventSha256；原子追加、明确 CAS 冲突、严格精确重放。
- `readAnchor()` 实现 Day 93 早课只读接口；本地冻结版本与锚点比对仍是 `action=hold`、`authenticatedExternalAnchorCount=0`、`publishAuthorized=false`。

## 动手命令

```bash
npm ci
npm run test:recovery-writer-inventory-audit-anchor
npm run test:recovery-writer-inventory-audit-checkpoint-cas
```

新测试使用 Node.js 22+ 内置 `node:sqlite` 和临时目录：两个连接竞争、锁争用、首次追加/重放、不同事件冲突、撤销后的不可复活、重启恢复、Inventory 旧 SQL 回滚检测、SQL trigger 拒绝以及 owner 删除 trigger 后的链损坏检测。

## 威胁边界

它不接入 mTLS/IAM、真实部署全集、外部不可回滚服务、可信时间或独立授权身份。攻击者若同时回滚两个 SQLite 文件（以及可控参照），仍可能制造一致的旧世界。更强的 SQL 攻击者甚至能重算事件链。CI PASS 只证明失败关闭实验按预期工作，绝不授权生产 GO。

## 下一步

Day 93 晚练将把本次持久水位和 Day 91–92 的 Evidence Chain / Release Blocker 串联，增加同域双重回滚的负面检查点。未来生产接口需要**独立服务身份、认证查询、权威单调持久层、防回滚/高水位证明、真实 Host 证据与 Consumer ACK**。
