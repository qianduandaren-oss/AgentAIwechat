# Day 29 · Concurrency / Backpressure

Day 29 从 Deployment Boundary 继续。核心问题：单次 Agent Run 有预算，不等于整个服务能承受无限并发。

## 三个概念

- Concurrency Limit：限制同时进入昂贵执行区的 Agent Run 数量。
- Queue：容量允许时等待，而不是立刻把请求全部压给 LLM / Tool Provider。
- Backpressure：当执行槽位和等待队列都满时，明确拒绝或降级，让上游感知系统已经过载。

推荐边界：HTTP/API -> Admission Controller -> ProductionAgentRuntime.run() -> LLM / Tools。

不要只在 LLM Provider 前加 semaphore，因为一个 Agent Run 可能多轮调用 LLM 和 Tool；Day 29 首先控制 run 级并发，后续再讨论 Provider 级细粒度限流。

## 第一版状态

```text
maxConcurrentRuns
maxQueuedRuns
activeRuns
queuedRuns
```

状态转移：有空位直接 admitted；无空位但队列未满则 queued；两者都满则 overloaded/rejected。完成一个 Run 后释放槽位并唤醒队首请求。

## 生产边界

Backpressure 不应该表现为无限 Promise 堆积。队列必须有界，拒绝必须可观测，并为后续 graceful shutdown 保留 drain 语义。

Day 29 午练将在 `src/runtime/` 中实现有界 RunAdmissionController，并接入 ProductionAgentRuntime，补并发与过载 Integration Test。