# Day 77 早课｜Writer Epoch 与 Fencing Token：让旧 Worker 的写入在数据库里失效

日期：2026-11-06（北京时间）｜Week 11 / Day 77｜15–25 分钟

## 今天学什么

Day 76 的 CutoverEvidenceGuard 会在候选操作前重新读取部署证据，但它仍存在 TOCTOU：检查通过后，旧 Worker 可能复活。今天学习 Writer Epoch（单调递增的写入代次）与 Fencing Token（持久化写入栅栏）。目标不是再增加一个布尔值，而是让**旧代次的写操作在同一个 SQLite 事务内被拒绝**。

## 核心概念

- Writer Epoch：每次切换合法写入者时由权威存储单调递增的整数，例如 41 → 42；不能由 Worker 自己生成或复用。
- Fencing：每笔受保护的写入都必须在同一原子事务内验证调用者的 epoch 等于数据库当前 epoch。旧 Worker 带 epoch=41，即使重新上线，也无法修改 epoch=42 的数据。
- CAS 与 Fencing 的区别：CAS 保护记录版本；Fencing 保护写入者代次。两者应组合使用，避免旧 Worker 读取新版本后绕过代次限制。

```text
旧 Worker A(epoch=41) ───────┐
                            ▼
                    SQLite BEGIN IMMEDIATE
新 Worker B(epoch=42) ───→ 当前 epoch=42
                            ├─ A: 41 != 42 → 拒绝
                            └─ B: 42 == 42 → 再校验 Outbox version / lease
```

一个候选表结构：

```sql
CREATE TABLE recovery_writer_fence (
  scope TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL CHECK(epoch > 0),
  owner_id TEXT NOT NULL
);
```

写操作伪代码：

```ts
db.exec("BEGIN IMMEDIATE");
try {
  const current = readWriterFence(db, "recovery-outbox");
  if (current.epoch !== callerEpoch || current.ownerId !== callerId) {
    throw new Error("stale_writer_fenced");
  }
  // 在同一事务内检查 Outbox version、leaseToken、eventId
  // 再执行 UPDATE ... WHERE version = expectedVersion
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
```

**边界：**只在新 Gateway 检查 epoch 不够。如果旧 Dispatcher 仍能直接 UPDATE 原表而不检查 epoch，Fencing 仍可被绕过。真正的强制边界需要数据库权限隔离、统一写入服务或所有写路径都无法绕过的数据库约束。SQLite 没有像 PostgreSQL 那样的用户级 GRANT，因此需要特别审查同进程数据库文件访问权；不能把示例当作生产安全隔离。

## 工程例子

Day 74 的 `SQLiteRecoveryOutboxDeliveryClaimer.claim()` 已使用 `BEGIN IMMEDIATE` 和 Outbox version CAS。午练将基于现有表与接口增加 writer fence 的候选存储，验证 A 在 epoch 41 取得租约、B 将 epoch 推进到 42 后，A 的迟到写入失败；B 仍需通过 lease 和版本检查。切换 epoch 不会撤销已经发出的网络请求，消费者 Inbox 持久化去重仍然必要。

## 三个必须记住的点

1. **Epoch 必须由持久化权威单调分配**，不能由进程时钟或随机数代替。
2. **验证 epoch 与业务 UPDATE 必须在同一事务中**，否则检查后仍有竞态。
3. **Fencing 只对实际执行检查的写入口有效**；旧 SQL 直写、真实外部副作用和已发网络请求不会自动受保护。

## 思考题

Worker A(epoch=7) 已经领取 E；Worker B 把权威 epoch 推进到 8。A 读取最新 Outbox version 后尝试 ACK。仅检查 version CAS 能否拒绝 A？

**思考方向：**不能保证。A 可能拿到最新 version，仍需要独立校验 epoch、当前 lease 和 ACK 身份；且校验必须与写入原子化。

## 后续安排

12:00 在同一 SQLite Runtime 实现候选 Writer Epoch Store 与 CAS，并用双连接测试旧 Worker 拒绝。18:00 检查旧 Dispatcher 旁路、进程重启和 epoch 轮换时的边界。Day 77 是 7 的倍数，今晚额外做 Week 11 阶段总结与 Checkpoint。发布仍 NO_GO。

## 代码仓库

https://github.com/qianduandaren-oss/AgentAIwechat

本次早课新增本架构笔记；真正的 Epoch Store 与测试留待午练。当前旧 Dispatcher/raw ACK 仍未强制隔离，生产 NO_GO。

## 文章归档

https://github.com/qianduandaren-oss/AIAgentAutoArticle

目标路径：articles/2026-11/day-77/morning.md。