# Day 77 晚练：Writer Epoch 重启、旧 Worker 与旁路验证

日期：2026-11-06。承接早课 Epoch/Fencing 原理和午练 SQLiteWriterEpochStore。

## 复现步骤
```bash
npm ci
npm run test:recovery-writer-epoch
npm run test:recovery-writer-epoch-evening
```

晚练回归：A(epoch1) 更新；B 接管(epoch2)；A 旧代次拒绝；A 进程重开后仍被拒绝；B 更新；C(epoch3) 接管后 B 被拒绝；C 更新；最后使用原始 DatabaseSync 直接 UPDATE，明确演示旧 SQL 旁路仍能成功。该测试是刻意的风险证明，不是安全验收。

## 发布门禁（NO_GO）
- Epoch Store 只保护显式调用 guardedUpdate() 的路径，尚未接入 Outbox claim/ack。
- 旧 RecoveryOutboxDispatcher、原始 acknowledge 和 SQLite 直写尚未隔离。
- 真实消费者 ACK 认证、跨进程/部署故障注入、权限撤销和统一写入服务尚未完成。
- 生产前必须统一受保护写入权威，并让旧进程不能直接访问数据库文件；不能仅依赖应用层布尔值或单次 Bootstrap。

## Week 11 Checkpoint
参见 docs/checkpoints/week11-day77.md。