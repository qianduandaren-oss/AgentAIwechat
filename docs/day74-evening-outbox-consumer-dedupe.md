# Day 74 晚练｜消费者 Inbox 幂等与 ACK 丢失（2026-11-03）

## 接上早课和午练

- 早课：一条 Outbox 行不保证只投递一次，eventId 必须跨 attempt 稳定。
- 午练：生产者同库 \`recovery_outbox_delivery_leases\` 原子认领，旧 token ACK 不得覆盖新租约。
- 晚练：新增 \`SQLiteRecoveryOutboxConsumerInbox\`，用**与生产者不同的 SQLite 文件**模拟下游消费者。Inbox 和本地模拟业务效果在消费者的同一 \`BEGIN IMMEDIATE\` 事务中写入，eventId 为主键。

\`\`\`text
Producer DB: Outbox(E) pending
  -> Dispatcher A claim(token A)
  -> Consumer DB: INSERT inbox(E) + INSERT business_effect(E) -> COMMIT
  -> ACK 丢失 / A 崩溃
  -> lease 过期，Dispatcher B claim(token B)，仍发送 E
  -> Consumer DB: 查到同一 E + 完整不可变绑定 -> replayed，不重复 effect
  -> B 收到可信 ACK 后标记 dispatched；旧 token A 不得 ACK
\`\`\`

## 不可变绑定和事务

\`recovery_consumer_inbox\` 保存 eventId、outboxId、commandId、runId、kind、原始事件 payload、首次消费时间。重放时可以忽略发送 attempt/version 的变化，但必须逐项比对业务事件身份和 payload。另有 \`recovery_consumer_business_effects\`，其 INSERT 与 Inbox INSERT 同事务；任一步故障整体回滚。

消费者持久化去重解决的是重复事件在**这个 SQLite 业务效果域**内只应用一次；不能推导为真实短信、支付、外呼等外部副作用 exactly-once。要做到真实消费者安全，必须把去重登记和业务副作用置于同一个原子权威；若业务副作用在第三方，则还需要第三方幂等、Fencing 或可信查询。

## 测试与边界

\`npm run test:recovery-outbox-consumer-dedupe\` 覆盖 12 个独立场景：ACK 丢失后的租约过期重领、双消费者连接、两处故障注入、payload/Command 错绑、重启重放、异常 envelope、Inbox/Effect 事实不一致、attempt 递增、迟到投递等。

**仍未完成：**
- 当前 \`RecoveryOutboxDispatcher\` 内存路径没有统一到持久化 Claim，仍存在潜在旁路。
- \`acknowledge(source: "authenticated_consumer_adapter")\` 的字符串标签不构成认证；演示测试里手工传入，生产必须使用可信 Adapter 验证事件身份和真实消费者响应。
- 无真实网络 Publisher、签名/认证、持久化去重保留期清理策略、跨进程故障注入和消费者实际业务事务验证。
- 当前 Inbox 仅模拟独立 SQLite 消费者，没有与生产者同库事务的虚假假设。它也不实现跨服务分布式事务。

**发布结论：NO_GO。**
