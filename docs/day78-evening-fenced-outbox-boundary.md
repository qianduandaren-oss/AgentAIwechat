# Day 78 晚练｜Fenced Outbox 边界与 SQL 旁路

日期：2026-11-07。承接早课联合事务设计、午练 SQLiteFencedOutboxDelivery 候选实现。

## 验证范围
- Epoch 轮换后，旧 Worker 的 claim 与 ACK 被拒绝；
- 新 Worker 可在租约过期后重新 claim；
- 旧 Lease Token 不能确认新租约；
- 重启后的旧 Epoch 仍被拒绝；
- **故意证明**直接 UPDATE recovery_outbox 可绕过候选 Fencing。

运行 `npm run test:recovery-fenced-outbox-evening`，另运行 `npm run test:recovery-fenced-outbox` 做前序回归。

## 安全边界
这是候选模块回归，不是生产认证测试。SQLite 没有表级用户授权；旧 Dispatcher、raw acknowledge 与持有数据库文件写权限的进程仍可能绕过候选类。真实消费者 ACK 签名验证、独立受信写入服务、混合版本部署隔离和 CI 结果仍需验收。**NO_GO**。

## 后续
Day 79 优先设计单一写入服务和旧入口切断，禁止把客户端自报的 Epoch 或 Adapter 配置视为授权。
