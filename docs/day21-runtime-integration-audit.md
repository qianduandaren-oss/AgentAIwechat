# Day 21 午练：Runtime Integration Audit

日期：2026-09-11

本次沿 ProductionAgentRuntime → runAgentLoop → LLM / Tool 主链检查课程能力是否真正生效。

## 已进入主链

- RuntimeConfig
- Resilient LLM Invoker（timeout / retry）
- TraceRecorder
- AgentRunBudget（step / model call / token / cost）
- SecureToolExecutor
- Permission / Approval / Idempotency / Audit
- Prompt Injection Guard
- Tool Result Sensitive Data Projection

## 本次发现并修复的缺口

`budget-policy.ts` 已存在，但之前只在独立 Demo 中使用，Production Runtime 没有把 Budget Policy 接入 Agent Loop。

本次增加：

- AgentLoopRuntimeOptions.runBudgetLimit
- AgentLoopRuntimeOptions.budgetWarningThreshold
- Agent Loop 在 LLM 前后读取 Budget Snapshot 并执行 evaluateBudgetPolicy()
- warning 状态停止继续扩展 Tool Calls
- exhausted / shouldFinish 状态阻止继续执行
- Trace Span 增加 budgetState / budgetUsageRatio
- ProductionAgentRuntime 把 config.agent 作为 runBudgetLimit 传入 Agent Loop

## 当前边界

当前 warning 策略采用保守实现：停止新增 Tool Call 并抛出明确错误。后续可以升级为“收口模式”，让 Planner 基于已有 Observation 生成最终回答，而不是简单异常退出。

`preferCheaperModel` 目前仍只是策略决策字段，尚未接入多模型路由，因此不能宣称已经实现自动模型降级。
