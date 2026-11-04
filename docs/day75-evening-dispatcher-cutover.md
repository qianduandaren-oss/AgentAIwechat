# Day 75 晚练：可信 ACK Gateway 与旧 Dispatcher Cutover

日期：2026-11-04。延续早课 ACK 身份合同、午练 VerifiedConsumerAckAdapter。

本次增加 `RecoveryVerifiedDeliveryGateway`，只公开 claim / confirm / inspect；内部复用 SQLite lease CAS 与 `acknowledgeVerifiedConsumerDelivery()`。测试包含抢占 busy、验证失败 fail closed、伪造 token 拒绝、成功确认后 dispatched，共七项断言。

```bash
npm ci
npm run test:recovery-dispatcher-cutover
npm run test:recovery-authenticated-ack
```

## 安全边界

Gateway 是候选组合层，不是生产入口；构造器仍可被不可信代码传入假 Adapter，旧 `RecoveryOutboxDispatcher` 和 `SQLiteRecoveryOutboxDeliveryClaimer.acknowledge()` 仍可绕过它。禁止把本地模拟验证器当作真实认证。上线必须由可信启动器固定 Adapter/Consumer 合同，限制原始 store 写方法访问，关闭旧派发路径，并增加真实 mTLS/签名、跨进程故障与消费者去重验证。

**发布 NO_GO。**
