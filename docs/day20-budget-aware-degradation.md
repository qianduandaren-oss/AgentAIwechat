# Day 20 晚练：Budget-aware Degradation

硬预算负责阻止越界，预算策略负责在接近上限时提前收口。

`evaluateBudgetPolicy(snapshot, limit)` 取 Step、Model Call、Token、Cost 四个维度中的最高使用率：

- `< 80%`：healthy，可继续检索和 Reflection。
- `>= 80% 且 < 100%`：warning，停止额外检索和 Reflection，优先便宜模型并准备收口。
- `>= 100%`：exhausted，停止扩展动作并结束。

运行：

```bash
npm run demo:budget-policy
```

注意：当前策略模块已经可运行，但尚未自动改变 Agent Loop 的 Planner/RAG/Reflection 分支；下一阶段会把 policy decision 作为 Runtime State 接入完整 Agent 项目。
