# Day 30 早课：Queue Timeout / Cancellation

Day 29 已完成 Run Admission：限制并发、使用有界 FIFO 队列，并在满载时明确拒绝请求。Day 30 继续补齐等待生命周期。

## 核心问题

有界队列只解决“最多等多少个”，没有解决“一个请求最多等多久”和“调用方已经取消后是否还应继续等待”。如果等待者没有生命周期，已经超时或断开的请求仍可能在稍后拿到执行槽位并继续消耗 LLM / Tool 成本。

## 目标语义

```text
acquire({ timeoutMs, signal })
├─ slot available -> admitted
├─ queued -> wait
├─ timeout -> remove waiter + RUN_QUEUE_TIMEOUT
└─ aborted -> remove waiter + RUN_CANCELLED
```

关键要求：

1. 超时/取消必须把 waiter 从 FIFO queue 中移除，不能留下 ghost waiter。
2. timeout / abort / release 之间可能竞争，完成动作必须幂等，只允许一个结果获胜。
3. AbortSignal 应从 API/HTTP 边界向 Runtime 传播，而不是只在 Admission 层结束。
4. Queue Timeout 只限制等待阶段；真正执行阶段还需要 cancellation propagation。

## 与 Graceful Shutdown 的关系

后续 shutdown 时，Runtime 需要停止接收新请求、取消或拒绝队列中的等待者，并给 active run 一个 drain deadline。Queue Cancellation 是 Graceful Shutdown 的前置能力。

## 午练计划

扩展 `RunAdmissionController.acquire()`，支持 `timeoutMs` 与 `AbortSignal`，定义稳定错误码 `RUN_QUEUE_TIMEOUT` / `RUN_CANCELLED`，补可控测试，验证 timeout、abort、正常 FIFO 唤醒和竞争条件。