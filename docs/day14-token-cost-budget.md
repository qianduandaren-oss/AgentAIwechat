# Day 14：Token / Cost Observability

Day 13 已经能回答“Agent 哪一步慢、哪一步失败”。Day 14 继续补生产环境最现实的一层：一次 Agent Run 到底用了多少 Token、花了多少钱，以及什么时候必须停止继续调用模型。

## 代码位置

```text
src/observability/token-usage.ts
src/observability/model-pricing.ts
src/observability/budget-guard.ts
src/demos/day14-cost-budget-demo.ts
```

## 运行链

```text
LLM Request
  ↓
LLM Response
  ↓
TokenUsage
  ↓
ModelPricing
  ↓
CostBreakdown
  ↓
BudgetGuard
  ├─ within budget → continue
  └─ exceeded → BudgetExceededError
```

`resolveTokenUsage()` 优先读取 Provider 返回的 usage；教学 Mock 或 Provider 没有 usage 时，使用字符数估算 Token，并明确标记 `source=estimated`。

`BudgetGuard` 同时支持：

- `maxTokens`
- `maxCostUsd`

Agent Loop 已接入这套能力，每个 LLM Span 会记录 input/output/total tokens 与 estimatedCostUsd。

## Demo

```bash
npm run build
node dist/demos/day14-cost-budget-demo.js
```

第一轮消耗会成功，第二轮超过预算后会被 BudgetGuard 阻断。
