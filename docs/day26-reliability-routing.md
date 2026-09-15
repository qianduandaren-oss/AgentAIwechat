# Day 26 早课：Reliability Routing / Provider Fallback

日期：2026-09-16

Day 25 已完成成本感知模型路由：正常 agent_turn 使用 primary，预算 warning 下的 agent_finalize 可使用 economy，并记录 model.route Trace。Day 26 进入可靠性路由：区分“因为预算主动降级”和“因为 Provider 故障被动切换”。

## 核心边界

- Cost Routing：由预算/任务策略主动选择模型。
- Reliability Routing：当前 Provider 出现可恢复故障后，选择备用 Provider。
- Retry：同一个 Provider 再试。
- Fallback：换另一个 Provider 再试。

第一版只允许对 timeout、429/rate limit、5xx、connection/network、temporary 等瞬时故障考虑 fallback；鉴权失败、请求参数错误、安全/权限拒绝等确定性错误不应通过换 Provider 掩盖。

推荐顺序：route -> primary retry -> classify failure -> fallback decision -> fallback provider -> trace decision/result。

当前仓库 `createResilientLLMInvoker()` 已经支持同 Provider 的 timeout/retry，`CostAwareModelRouter` 已支持 primary/economy 成本路由，但还没有 Provider Failure -> Fallback Provider 的真实主链。午练应在保持现有 Runtime Contract、Budget 和 Trace 的前提下补最小 Reliability Router/Fallback Invoker，并增加 Integration Test。
