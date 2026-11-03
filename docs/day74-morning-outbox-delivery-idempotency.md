# Day 74 早课：Outbox Delivery Idempotency 与 ACK 歧义

日期：2026-11-03。承接 Day 73 同库 Receipt Consumption Finalizer。

## 已有事实

Day 73 的 Finalizer 在一个 SQLite 写事务中提交 Consumption、Control CAS、Command terminal、Effect committed 与 Outbox 唯一事件。这只能保证**一次本地事件入库**，不能保证下游只收到一次。

现有 `src/runtime/recovery-outbox.ts` 的 `RecoveryOutboxDispatcher` 依赖 `listPending -> markAttempt -> publish -> markDispatched`。当 publish 已到达消费者而 ACK 丢失时，记录仍 pending；两个 Dispatcher 并发时也缺少持久化 claim/lease。因此现有实现不得用于声称 exactly-once 的生产交付。

## 关键故障窗口

```text
BEGIN IMMEDIATE (Day 73)
  INSERT Outbox(eventId = E)
COMMIT
  Dispatcher publish(E)
  Consumer applied(E)
  ACK lost / Dispatcher crashes
  Outbox still pending
  Next Dispatcher may publish(E) again
```

正确边界：消费者对 `eventId` 持久化去重，去重与业务应用在同一消费者原子权威中完成；生产者持久化 claim/lease、发送尝试、ACK 关联和重启恢复。ACK 丢失时不得重新执行 Effect Tool；最多按已验证的消费者幂等合同重投同一事件。

## 本次新增

- `src/runtime/recovery-outbox-delivery-contract.ts`：纯 `planRecoveryOutboxDelivery()`，复用 `RecoveryOutboxRecord`。只返回 hold / already_dispatched / requires_atomic_delivery_claim。
- `src/demos/day74-morning-outbox-delivery-contract-test.ts`：覆盖稳定 eventId、版本、无副作用、无去重合同、保留期不足、ACK 未验证和无效 Outbox 等 14 项检查。
- 命令：`npm run test:recovery-outbox-delivery-contract`。

通过计划并**不允许立即 publish**，还必须由午练设计的 SQLite 原子 claim 决定。合同中的消费者能力是受信服务端提供的已验证证据，不是浏览器或 LLM 自报。

## 下一步与发布边界

Day 74 午练：持久化 delivery attempt / lease、抢占与过期恢复；Day 74 晚练：ACK 丢失、重复消费者、两 Dispatcher 和重启测试。

真实消费者幂等、下游 ACK、Provider Registry/IAM 和全入口隔离仍未验收。**NO_GO**。
