# Day 41 · Transactional Checkpoint Store

Day 41 把 CAS 从 JavaScript 进程内判断推进到共享持久层语义。

## 核心问题

下面这种方式不是真正的跨进程 CAS：

```text
SELECT version
↓
JavaScript if
↓
UPDATE
```

两个 Worker 可以同时 SELECT 到 v7，然后都通过判断。

真正的 Compare + Write 必须由共享存储原子完成，例如 PostgreSQL：

```sql
UPDATE agent_checkpoints
SET
  version = version + 1,
  payload = $1,
  updated_at = CURRENT_TIMESTAMP
WHERE
  run_id = $2
  AND version = $3;
```

```text
affected rows = 1
→ success

affected rows = 0
→ CheckpointConflictError
```

## Adapter Contract

代码中的：

```text
src/runtime/transactional-checkpoint-store.ts
```

定义了 `TransactionalCheckpointDatabase`：

- `load`
- `insertIfAbsent`
- `updateIfVersion`

数据库实现必须保证后两个操作在共享持久层中是原子的。

`TransactionalCheckpointStore` 再把数据库结果翻译成统一 Runtime 语义：

```text
save success
or
CheckpointConflictError
```

上层 Recovery Runtime 不需要知道 PostgreSQL、SQLite 或其他存储实现细节。

对应测试：

```text
src/demos/transactional-checkpoint-test.ts
```

测试验证两个 Store 实例基于同一 v1 时，只有一个可以推进到 v2，另一个必须 Conflict。
