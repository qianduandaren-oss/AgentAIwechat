# Day 25 早课：Cost-aware Model Routing

日期：2026-09-15

## 目标

把 Budget Policy 中已经存在的 `preferCheaperModel` 从“策略信号”推进为清晰的模型路由架构，但早课阶段先固定边界，不直接修改生产主链。

## 当前状态

`evaluateBudgetPolicy()` 在 warning / exhausted 时已经返回 `preferCheaperModel: true`，但 `ProductionAgentRuntime` 当前只持有一个 `LLMProvider`，所有请求仍通过同一个 provider 执行。因此目前还不存在真实的模型降级。

## 目标架构

```text
LLMRequest
  ↓
ModelRouter
  ├─ primary provider
  └─ economy provider
       ↑
BudgetPolicyDecision.preferCheaperModel
```

路由依据应该来自 Runtime Policy，而不是 Prompt。第一阶段建议只让 `agent_finalize` 在预算 warning 后使用 economy provider，普通 `agent_turn` 继续使用 primary provider。

## 设计原则

1. Provider 是能力接口，Router 是选择策略，不要把两者揉成一个类。
2. `preferCheaperModel` 是偏好信号，不应该绕过 Timeout、Retry、Tracing 和 Budget。
3. 先从 Closing Mode 的 `agent_finalize` 做最小切换，再逐步扩展到其他任务。

## 下一步

午练实现最小 `ModelRouter`，给 Production Runtime 增加 primary/economy provider 路由，并补 Integration Test 验证 normal 使用主模型、closing finalize 使用低成本模型。
