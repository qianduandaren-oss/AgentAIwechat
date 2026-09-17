# Agent AI 工程师 · Day 27 早课

## Circuit Breaker / Provider Health：Provider 连续故障时，别让每个请求都重新撞墙

日期：2026-09-17

Day 26 已经完成 Retry + Reliability Fallback：单次请求里 primary 先重试，仍失败且属于可恢复故障时，最多跨 Provider 一次。Day 27 往前一步：如果 primary 连续几十个请求都在超时或 429，不能让每个新请求都重复经历“primary → retry → fallback”。这会放大延迟、请求量和潜在成本。

## 今天学什么

核心概念是 Circuit Breaker（熔断器）和 Provider Health（供应商健康状态）。

```text
CLOSED
  ↓ 连续失败达到阈值
OPEN
  ↓ 冷却时间结束
HALF_OPEN
  ↓ 试探成功 → CLOSED
  ↓ 试探失败 → OPEN
```

CLOSED 表示正常放行；OPEN 表示暂时不再请求故障 Provider；HALF_OPEN 只放少量探测请求验证是否恢复。

## 为什么 Retry / Fallback 还不够

Day 26 解决的是单次请求恢复。假设 primary 已经持续故障：

```text
请求 A → primary → retry → fallback
请求 B → primary → retry → fallback
请求 C → primary → retry → fallback
```

虽然最终可能都 completed，但每个用户都承担了 primary 的失败延迟。Circuit Breaker 解决跨请求记忆：Runtime 记住 Provider 最近是否健康。

## Circuit Breaker 应该放在哪

它不属于 Agent Loop，也不应该塞进 Prompt。更合理的位置是 Provider 调用边界：Model Router 决定想用谁，Circuit Breaker 判断这个 Provider 当前能不能尝试，Resilient Invoker 负责单 Provider 的 timeout/retry，Reliability Fallback 负责失败后的跨 Provider 恢复。

```text
Model Router
↓
Circuit Breaker
↓
Resilient Invoker
↓
Failure Classification
↓
Fallback
```

## 什么失败应该计入熔断

第一版只统计更像 Provider 健康问题的 transient failure：timeout、429、5xx、network。401、403、400、schema validation 不应该把 Provider 判成不健康，因为那通常是配置或请求问题。

## 三个必须记住的点

1. Retry 解决一次调用，Fallback 解决一次请求，Circuit Breaker 解决跨请求的持续故障。
2. 熔断器必须有 CLOSED / OPEN / HALF_OPEN，而不是简单 disabled=true；否则 Provider 恢复后没有安全的重新接入机制。
3. Provider Health 只记录基础设施健康，不要把业务错误、权限错误和 Prompt 错误混进去。

## 思考题

primary 因 429 连续失败后进入 OPEN，新的 agent_turn 应该怎么办？第一版更合理的是在调用前直接跳过 primary，选择已配置且健康的备用 Provider，并把 `circuit_open` 作为 reliability route reason 写入 Trace，而不是先等 primary 再失败一次。

## 中午继续什么

中午会实现最小 `ProviderCircuitBreaker`：failureThreshold、cooldownMs、CLOSED/OPEN/HALF_OPEN 状态转换，并把它接到 Reliability 调用边界。Integration Test 会用可控时钟验证：连续 transient failure 后 OPEN；OPEN 时不调用 primary；冷却后进入 HALF_OPEN；探测成功后恢复 CLOSED。

## 代码仓库

仓库：github.com/qianduandaren-oss/AgentAIwechat

早课新增本文档；Runtime 行为代码留到午练实现。
