# Day 75 早课｜Authenticated Consumer ACK 与 Dispatcher Cutover
日期：2026-11-04

Day 74 已有 SQLite delivery lease 与消费者 Inbox，但 `SQLiteRecoveryOutboxDeliveryClaimer.acknowledge()` 仅检查 `source: "authenticated_consumer_adapter"` 这个可伪造的字面值。它不是身份认证。

## 目标边界
- 可信 Adapter 在服务端验证 mTLS / 签名 / 受信通道，核对 consumerId、eventId、outboxId、commandId、runId、evidenceId 和时间。
- `reviewConsumerAckBinding` 只验证身份字段和观察时效，返回 `ackAuthorized: false`；不得让前端提交字符串绕过认证。
- Adapter 通过认证后，仍需在 SQLite 写事务中检查当前 leaseToken、lease 过期时间和 Outbox CAS。
- 旧 `RecoveryOutboxDispatcher` 仍可调用 `markAttempt → publish → markDispatched`；生产 Cutover 前必须封闭该旁路，统一单一派发入口。
- ACK 证据需要防重放、可审计；消费者 Inbox 的唯一 eventId 只解决模拟业务效果去重。

## 下一阶段
午练实现可信 Adapter 的注入边界及候选 Dispatcher 接线；晚练故障注入伪造 ACK、旧 leaseToken、双 Dispatcher 与旧路径绕过。当前发布 NO_GO。
