# Day 74 午练｜Outbox Delivery Claim / Lease（2026-11-03）

Day 73 的原子 Finalizer 只保证 Outbox 事件唯一入库。Day 74 早课的 `planRecoveryOutboxDelivery` 是只读前置合同，午练将 claim 下沉到**同一 SQLite**：`recovery_outbox`（现有）+ `recovery_outbox_delivery_leases`（新增）。

## 状态机

```text
pending v1
  → BEGIN IMMEDIATE + consumer contract + CAS
  → pending v2 / attempts=1 / leaseToken=A
      ├─ lease 未过期：第二 Worker → busy
      ├─ lease 过期：新 token B / pending v3 / attempts=2
      │                 旧 token A 的 ACK → reject
      └─ 可信 ACK(eventId, current token) → dispatched v3
```

消费端业务幂等键必须始终为 `eventId`，不能使用每次不同的 `leaseToken`。租约只能协调派发者；旧 Worker 仍可能在租约失效后把网络请求发出去，因此必须由**真实消费者持久化去重**抵抗重复副作用。

## 安全边界

- `source: authenticated_consumer_adapter` 是调用侧合同标签，**不是**认证证明；正式接入需要可信 Adapter 验证签名/会话/响应身份。
- `claim()` 只取得候选派发租约，不进行 HTTP publish。当前未接正式 Dispatcher、IAM、消费者事务、真实 ACK 查询。
- `acknowledge()` 拒绝过期、旧 token、错 eventId；成功后只改变同库 Outbox 状态。ACK 丢失时 lease 过期可再次派发，依赖消费者 eventId 去重。
- `RecoveryOutboxDispatcher` 的旧内存接口仍存在；不得把它当作此 SQLite claim 的生产入口。必须在后续封闭旁路。
- 数据库 `BEGIN IMMEDIATE` 不会锁住下游消费者或外部 Provider，不能声称 exactly-once。

## 测试

`npm run test:recovery-outbox-delivery-lease`：16 个 SQLite 场景，覆盖双连接争抢、租约过期、旧 ACK、可信 ACK、重启重开、事件身份篡改、去重合同不合格及输入错误。CI 验证 TypeScript Build + 既有回归。

发布裁决：**NO_GO**。
