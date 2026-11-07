# Day 78 早课｜把 Writer Epoch 接入 Outbox Claim / ACK 的同一事务
日期：2026-11-07；Week 12 / Day 78；20 分钟。

## 目标
Day 77 的 SQLiteWriterEpochStore 只保护主动使用 guardedUpdate 的代码，Day 74 的 SQLiteRecoveryOutboxDeliveryClaimer.claim()/acknowledge() 尚未校验 Epoch。今天明确联合事务的接线合同，不把独立 inspect() 当作授权。

## 当前仓库真实接口
- recovery-writer-epoch-store.ts：rotate、inspect、guardedUpdate；单独 SQLite 连接，尚未保护 Outbox。
- recovery-outbox-delivery-lease.ts：claim 在 BEGIN IMMEDIATE 中写 Outbox payload 和 Lease；acknowledge 在事务内检查 leaseToken、attempt、CAS，但 source 是可伪造的字符串。
- recovery-verified-delivery-gateway.ts：组合候选 claim 和认证 Adapter，仍未强制封闭旧入口。

## 目标联合事务
1. 受信协调器原子 rotate(scope='recovery-outbox', ownerId)，发放单调 epoch。
2. Claim / ACK 必须在**与 Outbox 相同的 SQLite 数据库和同一 BEGIN IMMEDIATE 事务**读取 recovery_writer_fence。
3. 核对 scope + epoch + ownerId；再核对 eventId、Lease、Outbox version CAS；全部通过才更新。
4. 旧 Worker 即使持有新 version 或旧 leaseToken 也应拒绝；认证 ACK 仍需 Adapter，Epoch 不代替消费者认证。
5. 不能只在 Gateway 外先调用 inspect()：检查和更新之间会发生 TOCTOU。
6. 不能将 Day 77 的通用 guardedUpdate 直接当成生产入口；它允许受信 SQL 字符串，而且旧 Dispatcher 可绕过。

## 午练实施顺序
先在既有 claimer 中设计可选的候选 fencedClaim/fencedAcknowledge 或受控事务辅助函数，保持现有测试兼容；确保同库 fence 表和原子检查；添加 A epoch1 → B epoch2 → A 拒绝、B 成功的双连接回归。不要宣称数据库权限隔离已经完成。

## 发布门禁
真实认证、旧 Dispatcher/raw ACK/直接 SQL 隔离、混合版本滚动部署与跨进程故障注入尚缺。生产 NO_GO。
