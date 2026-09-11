# Week 3 Checkpoint · Day 15–21

日期：2026-09-11

## 当前 Production Runtime 主链

```text
RuntimeConfig
  ↓
ProductionAgentRuntime
  ├─ Resilient LLM Invoker
  ├─ TraceRecorder
  ├─ AgentRunBudget / Budget Policy
  ├─ Prompt Injection Guard
  ├─ Sensitive Data Projection
  ├─ SecureToolExecutor
  │   ├─ Permission / Authorization
  │   ├─ Approval
  │   ├─ Idempotency
  │   └─ Audit
  ↓
runAgentLoop
```

## Week 3 已完成

- Agent 评测与 Trajectory
- Tracing / Observability
- Token / Cost 统计与预算
- Permission / Approval / Idempotency
- Authorization / Audit
- Prompt Injection Guard
- Sensitive Data Boundary
- RuntimeConfig / Provider Factory
- Timeout / Retry
- AgentRunBudget
- Budget-aware Policy
- Runtime Integration Audit

## 当前真实边界

Budget Policy 已进入 Agent Loop，warning 状态会停止继续扩展 Tool Calls；但完整 closing 模式与真实多模型降级尚未完成。`preferCheaperModel` 当前仍只是策略信号，不代表已经实现自动切换模型。

## 下一阶段

Day 22 起进入完整 Agent 项目收口：先补明确的 Run Result / Stop Reason，再把 HTTP/CLI 等 Adapter 统一接入 ProductionAgentRuntime，随后补 closing mode、部署入口、测试和作品集文档。

## 可复制 Checkpoint

已完成 Agent AI 工程师课程 Day 1–21，当前 TypeScript/Node.js 作品集项目已从基础 LLM/API、结构化输出、Function Calling、Tool Use、Agent Loop，逐步扩展到 Memory、RAG、MCP、Workflow、Planning/Reflection、Multi-Agent、Agent Eval、Tracing，以及 Permission/Authorization/Approval/Idempotency/Audit、Prompt Injection Guard、敏感数据边界、RuntimeConfig、Timeout/Retry、AgentRunBudget 和 Budget Policy。当前 ProductionAgentRuntime 已把主要安全、观测、预算和 Tool 执行能力接入真实主链；Budget Policy 的 warning 已能阻止继续扩展 Tool Calls，但 closing mode 和真实多模型降级还未完成。从 Day 22 继续，开始完整 Agent 项目收口，不重复前面内容。
