# Day 9：什么时候该拆 Multi-Agent？

Day 8 已经完成单 Agent 的 LLM Planner、Validation、Reflection 和 Re-planning。Day 9 不急着让多个 Agent 互相聊天，先解决架构边界：什么时候继续扩展一个 Agent，什么时候应该拆出第二个专职 Agent。

## 判断原则

优先保持 Single Agent，只有出现明确的职责边界时才拆分。

适合继续使用单 Agent：

- Goal 单一；
- Tool 数量仍可控；
- 上下文高度共享；
- 权限边界一致；
- 同一个 Planner 可以稳定决定下一步。

适合拆 Multi-Agent：

- 子任务需要明显不同的专业 Prompt / Context；
- 不同子任务拥有不同 Tool / Permission；
- 上下文过大，需要隔离；
- 子任务可以独立验收；
- 某个专职 Agent 可以被多个流程复用。

## 当前项目的演进方向

先从两个角色开始：

```text
CoordinatorAgent
  ↓ delegate
CustomerAnalysisAgent
  ↓ result
CoordinatorAgent
```

Coordinator 只负责分解、委派和整合，不直接拥有所有业务 Tool；CustomerAnalysisAgent 只处理客户分析相关 Tool。

## 反例

不要为了“看起来更 Agent”把一个简单流程拆成：

```text
SearchAgent → AnalysisAgent → WriterAgent → ReviewerAgent
```

如果这些角色共享同一上下文、同一权限、同一目标，而且没有独立验收边界，那么多 Agent 只会增加 Token、延迟、状态同步和调试成本。

## Day 9 目标

今天先建立 Multi-Agent 的最小抽象：AgentRole、AgentDescriptor、DelegationTask、DelegationResult。中午再实现 Coordinator 如何把一个子任务委派给专职 Agent。
