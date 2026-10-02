# Day 42 · SQLite Checkpoint Store

Day 41 已经把生产级 Checkpoint Store 需要的原子语义抽象成：

```text
load
insertIfAbsent
updateIfVersion
```

Day 42 开始把这个 Contract 接到真正的数据库。

## 为什么先用 SQLite

SQLite 仍然是一个文件，但它和 Day 40 的 JSON File Store 有本质区别：

```text
JSON File
→ 应用自己读 / 判断 / 写

SQLite
→ 数据库引擎负责事务、锁和原子 UPDATE
```

这让 CAS 第一次真正发生在持久层里。

## 表结构

```sql
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  run_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Checkpoint 继续以完整 Runtime Snapshot 保存。

## Conditional Update

```sql
UPDATE agent_checkpoints
SET version = ?, payload = ?, updated_at = ?
WHERE run_id = ? AND version = ?;
```

```text
changes = 1 → success
changes = 0 → CheckpointConflictError
```

Compare + Write 由 SQLite 原子执行。

## WAL 与 busy_timeout

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

它们改善并发读写体验和短时间锁竞争，但真正防止 stale write 的仍然是 `WHERE version = expectedVersion`。

## Day 42 验收目标

```text
Restart Test
+
Two Connection CAS Test
+
Crash Recovery Integration Test
```

原则保持不变：Runtime 依赖 CheckpointStore Contract；SQLite 只是 Infrastructure Adapter。
