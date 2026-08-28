# Week 1 Checkpoint：Day 1–7

第一阶段已经完成：

```text
LLM API
↓
Structured Output
↓
Function Calling
↓
Tool Use
↓
Agent Loop
↓
Memory
↓
RAG
↓
MCP
↓
Workflow
↓
Planning
↓
Reflection
```

当前 TypeScript 项目已经具备模型抽象、结构化响应、Tool Registry / Executor、Agent Loop、Memory、RAG、MCP、Workflow、Retry、Idempotency、Human-in-the-loop、Planner State、Action、Observation 和 Duplicate Guard。

需要继续巩固：

1. Agent Loop 和 Planner Loop 的关系。
2. Memory、Workflow State、Planner State 的边界。
3. 哪些判断交给 LLM，哪些规则必须由程序控制。

## 下一阶段

Day 8 从真实 LLM Planner 开始：使用 `callLLM() + Structured Output` 生成下一步 Action，再进入 Plan Validation、Re-planning 和更完整的 Reflection。

## 新对话进度锚点

Agent AI 工程师课程已完成 Week 1 / Day 1–7。下一阶段从 Day 8：用真实 LLM 实现 Planner + Structured Output 开始，不重复前面内容。
