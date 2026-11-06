# Day 77 午练｜SQLite Writer Epoch / Fencing Token

2026-11-06。延续 Day 76 Cutover TOCTOU：使用独立 SQLite authority 表、BEGIN IMMEDIATE 原子轮换 Epoch，使用同事务 guard + SQL 更新阻止旧代次写入。

- `SQLiteWriterEpochStore.rotate(scope, ownerId)`：受信协调器调用，代次单调递增。
- `guardedUpdate()`：在同一事务核对 scope、epoch、owner 后执行**受信静态 SQL**。不可接受外部用户传入的 SQL。
- `npm run test:recovery-writer-epoch`：双连接、轮换、旧 owner 拒绝、重启持久化测试。
- 未将 Guard 接入 Day 74 的 claim/ack；旧 Dispatcher、raw ACK 仍可绕过；没有真实授权与跨进程验收。生产 NO_GO。
