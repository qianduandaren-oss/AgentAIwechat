# Day 10：Agent Routing

Day 9 已经完成受控 Delegation Runtime：Coordinator 创建 DelegationTask，Delegation Guard 校验调用关系，再路由到具体 Agent。

Day 10 的目标是去掉 Coordinator 中写死的 `toAgentId`，让 Coordinator 根据 Goal 和 Agent Registry 动态选择合适的 Agent，同时仍然坚持：

- LLM/Selector 只负责提出 `agentId`；
- Registry 决定哪些 Agent 真正存在；
- `validateAgentSelection()` 拒绝未知或不可路由角色；
- Delegation Guard 继续决定当前调用方向是否允许；
- Agent 自身 Tool Permission 不因路由结果而扩大。

## 目标链路

```text
Goal
 ↓
Agent Registry
 ↓
Agent Selector
 ↓
Structured AgentSelection
 ↓
Selection Validation
 ↓
DelegationTask
 ↓
Delegation Guard
 ↓
Target Agent
```

## Morning scaffold

`src/multi-agent/agent-selection.ts` 先建立三个边界：

1. `AgentSelection`：选择结果必须包含 `agentId` 与 `reason`。
2. `listRoutableAgents()`：Coordinator 自身不进入可委派候选列表。
3. `validateAgentSelection()`：模型或规则选择器的输出在进入 Delegation Runtime 前必须经过 Registry 校验。

午练再把选择器接到 Coordinator，逐步替换 Day 9 写死的 `toAgentId: "customer-analysis"`。
