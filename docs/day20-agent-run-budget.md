# Day 20 · Agent Run Budget

生产 Agent 的成本控制不能只在请求结束后统计 token。Runtime 应在运行过程中同时限制 Step、模型调用次数、Token 与估算成本，并在预算耗尽前主动停止。

当前边界：

```text
RuntimeConfig
  ↓
AgentRunBudget
  ├─ maxSteps
  ├─ maxModelCalls
  ├─ maxTokens
  └─ maxCostUsd
```

`AgentRunBudget` 复用 Day 14 的 `BudgetGuard` 统计 Token/Cost，并额外负责 Step 和模型调用次数。Day 20 午练会把该预算真正接入 Agent Loop。