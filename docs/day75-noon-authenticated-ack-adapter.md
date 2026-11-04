# Day 75 午练｜Authenticated ACK Adapter 与 SQLite Lease 接线

日期：2026-11-04。承接早课 `reviewConsumerAckBinding()` 与 Day 74 `SQLiteRecoveryOutboxDeliveryClaimer`。

新增 `acknowledgeVerifiedConsumerDelivery()`：先读取可信 Outbox 记录，调用注入的 `VerifiedConsumerAckAdapter.verify()`，检查 eventId/outboxId/commandId/runId/consumerId/evidenceId 和观察时间，再由 SQLite 当前 leaseToken/expiry/CAS 确认 dispatched。验证失败返回 hold；租约冲突由 Ledger 拒绝。

**信任边界**：测试中的 verifier 是注入式模拟；没有真实 mTLS/签名验证，也没有绑定消费者 Inbox 证据的生产网络协议。旧 `acknowledge({source:"authenticated_consumer_adapter"})` 仍可被直接调用，旧内存 Dispatcher 也未封闭；因此这只是候选集成，绝不能发布 GO。

测试：`npm run test:recovery-authenticated-ack`（7 个候选场景），另运行 Day 74 lease/inbox 回归。
