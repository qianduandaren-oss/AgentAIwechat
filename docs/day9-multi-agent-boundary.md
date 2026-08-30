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

今天先建立 Multi-Agent 的最小抽象：AgentRole、AgentDescriptor、DelegationTask、DelegationResult。中午实现 Coordinator 把一个客户分析子任务委派给专职 Agent；晚上把 Agent Registry、Delegation Guard 和 Tool Permission 接进 Runtime。

## 12:00：Delegation Runtime

最小调用链：

```text
Coordinator
  ↓ DelegationTask
Delegation Runtime
  ↓
CustomerAnalysisAgent
  ↓ DelegationResult
CoordinatorState
```

核心文件：

```text
src/multi-agent/types.ts
src/multi-agent/customer-analysis-agent.ts
src/multi-agent/delegation-runtime.ts
src/multi-agent/coordinator.ts
src/demos/multi-agent-demo.ts
```

Delegation 不使用随意字符串，而是明确记录：

```text
id
fromAgentId
toAgentId
goal
input
```

返回结果同样进入 CoordinatorState，便于后续追踪、失败处理和继续委派。

## 18:00：Agent Registry + Delegation Guard

仅仅让 Coordinator 知道一个 Agent 名字还不够。生产系统需要由程序维护允许存在的 Agent、委派关系和 Tool 权限。

新增：

```text
src/multi-agent/agent-registry.ts
src/multi-agent/delegation-guard.ts
```

当前 Registry：

```text
coordinator
  allowedTools: []

customer-analysis
  allowedTools:
  - search_customer
  - search_chat_history
  - search_knowledge
```

当前委派策略：

```text
coordinator
  → customer-analysis
```

而下面这种反向委派会被程序拒绝：

```text
customer-analysis
  → coordinator
```

完整链路升级为：

```text
Coordinator
  ↓ DelegationTask
Delegation Guard
  ├─ source agent exists?
  ├─ target agent exists?
  └─ delegation allowed?
  ↓
Delegation Runtime
  ↓
CustomerAnalysisAgent
  ↓ DelegationResult
CoordinatorState
```

这里的核心原则和 Tool Permission 完全一致：

```text
LLM / Coordinator 可以提出委派
程序决定该委派是否允许
```

`AgentDescriptor.allowedTools` 也开始成为实际权限数据，而不是文档字段。后续子 Agent 接入真实 Tool Executor 时，必须通过 `canAgentUseTool()` 再进入具体 Tool。

## Day 9 验收

运行：

```bash
npm run build
npm run demo:day9
```

Demo 应同时覆盖：

```text
允许：coordinator → customer-analysis
拒绝：customer-analysis → coordinator
```

不要依赖 Prompt 里的“请不要调用其他 Agent”。真正边界必须由 Runtime 强制执行。
