# Day 19 晚练：Timeout / Retry

生产 Agent 要区分三层时间边界：单次 LLM/Tool 调用 timeout、Agent 总时限，以及任务级重试。Retry 只适合明确的瞬时故障，并应限制次数、使用退避；Authorization DENY、参数错误等确定性失败不应重试。

本次新增 `src/runtime/resilience.ts`，提供 `withTimeout()`、`withRetry()` 和 `TimeoutError`；`src/demos/resilience-demo.ts` 演示瞬时错误重试成功，以及超时主动取消。

运行：

```bash
npm run build
npm run demo:resilience
```

核心原则：Timeout 控制一次等待多久，Retry 控制失败后是否再花一次成本；Agent Loop 的 max steps / 总 deadline 则限制整个任务的预算。三者不能混成一个“失败重试 3 次”。
