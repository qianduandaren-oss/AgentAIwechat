# Day 45｜Durable Command Record + Transactional Outbox

Day 45 解决 Human Recovery 的双写窗口：Recovery 状态可能已经推进，但 Audit / Recovery Event 仍未可靠落盘。

核心模型：

```text
RecoveryOperationCommand
↓
Durable Command Record
↓
Atomic State Mutation + Outbox Record
↓
Outbox Dispatcher
↓
Audit / Recovery Event Consumer
```

## Command Record

每条人工恢复命令使用稳定的 `commandId`。重复提交相同 `commandId` 时，系统先读取已有处理状态，而不是重新执行 Recovery。

状态：

```text
accepted → executing → succeeded
                    ↘ failed
accepted → rejected
```

Command Record 自带 `version`，用于防止两个 Worker 同时执行同一条命令。

## Transactional Outbox

Outbox 的关键不是“多一张表”，而是 Runtime/Control 状态变化、Command Record 和 Outbox Record 在真正的数据库实现里必须由同一事务提交。

```text
BEGIN
UPDATE checkpoint / control
UPDATE recovery_command
INSERT recovery_outbox
COMMIT
```

这样可以把“事件丢失”问题转换成“事件可能重复投递”。Dispatcher 提供 at-least-once delivery，消费者依赖 `eventId` / `commandId` 做幂等。

## 本阶段边界

Day 45 午练先实现 InMemory Command Store、InMemory Outbox Store 与 Dispatcher，用测试验证命令幂等、pending 重试、publish 成功但 mark dispatched 失败后的重复投递。内存版本只验证 Contract，不冒充数据库事务；真正的 SQLite/PostgreSQL 原子事务在后续继续落地。
