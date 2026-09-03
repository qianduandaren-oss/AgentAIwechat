# Agent AI 工程师 · Day 1–13 完整可运行项目

这是 Agent AI 工程师课程的 TypeScript 实战代码仓库。

项目不是每天新建一个孤立 Demo，而是在同一套 Agent Runtime 上持续演进。目前已经从最基础的 LLM 调用，一路推进到 Multi-Agent、Evaluation、Trajectory 和 Tracing / Observability。

```text
LLM / Structured Output
→ Tool Calling / Agent Loop
→ Memory
→ RAG
→ MCP
→ Workflow / Durable Execution
→ Planning / Reflection
→ LLM Planner / Validation / Re-planning
→ Multi-Agent / Delegation
→ Agent Routing
→ Agent Evaluation
→ Trajectory Evaluation
→ Tracing / Observability
```

当前进度：**Day 13 早课**。

Day 13 目前已经完成 Trace Contract，下一步是在现有 `runAgentLoop()` 中接入轻量 `TraceRecorder`，开始真正记录 Agent / LLM / Tool Span 的耗时和状态。

---

## 运行方式

安装依赖并编译：

```bash
npm install
npm run build
```

运行主项目：

```bash
npm run demo
```

或直接运行已经编译好的入口：

```bash
node dist/index.js
```

专项 Demo：

```bash
npm run demo:day7
npm run demo:day8
npm run demo:day9
```

Evaluation：

```bash
npm run eval:routing
npm run eval:trajectory
```

---

## Day 1–13 学习路线

```text
Day 1   LLM / Structured Output
  ↓
Day 2   Tool Calling / Agent Loop
  ↓
Day 3   Memory / Context
  ↓
Day 4   RAG / Retrieval
  ↓
Day 5   MCP / Capability Discovery
  ↓
Day 6   Workflow / State / Retry / Idempotency / HITL
  ↓
Day 7   Planning / Action Space / Reflection / Guardrail
  ↓
Day 8   LLM Planner / Validation / Re-planning
  ↓
Day 9   Multi-Agent / Delegation / Permission Boundary
  ↓
Day 10  Agent Routing / Agent Selection / Validation
  ↓
Day 11  Agent Evaluation / Regression
  ↓
Day 12  Trajectory / Path Evaluation
  ↓
Day 13  Tracing / Observability
```

---

## 当前整体结构

```text
                              Memory
                                ↑
                                │
User Goal → Router → Context Builder ← RAG
    │
    ├─ 普通问答 → LLM
    │
    ├─ 开放式分析
    │       ↓
    │    LLM Planner
    │       ↓
    │ Structured Output
    │       ↓
    │   Validation
    │       ↓
    │ Reflection / Policy
    │       ↓
    │    Executor
    │       ↓
    │ Observation
    │       └────────→ Re-planning
    │
    ├─ 多 Agent 任务
    │       ↓
    │   Coordinator
    │       ↓
    │   Agent Router
    │       ↓
    │ Agent Selection
    │       ↓
    │ Selection Validation
    │       ↓
    │ Delegation Guard
    │       ↓
    │ Specialist Agent
    │
    └─ 确定性业务流程
            ↓
         Workflow
            ↓
        LLM Node
            +
        Program Node
            ↓
        MCP Executor
            ↓
         MCP Client
            ↓
         MCP Server
```

运行事实继续进入：

```text
Agent Runtime
     ↓
Trajectory / Trace
     ↓
Evaluation
     ↓
Regression / Metrics / Observability
```

核心原则一直没有变：

```text
LLM 负责提出判断、选择和下一步建议
程序负责权限、校验、状态、重试、幂等和安全边界
```

---

# Day 1：LLM API 与 Structured Output

核心文件：

```text
src/llm/client.ts
src/llm/response-parser.ts
src/llm/providers/mock-provider.ts
src/day1/lead-analyzer.ts
```

主要能力：

```text
callLLM()
extractToolCalls()
extractText()
extractStructured()
```

调用链：

```text
业务代码
  ↓
callLLM()
  ↓
LLMProvider.generate()
  ↓
模型响应
  ↓
extractStructured()
  ↓
业务结果
```

`callLLM()` 是统一 LLM 调用入口，上层业务不直接绑定某一家模型 SDK。

项目默认使用 `MockLLMProvider`，因此没有 API Key 也可以运行课程代码。

---

# Day 2：Function Calling / Tool Use / Agent Loop

核心文件：

```text
src/tools/registry.ts
src/tools/executor.ts
src/tools/implementations.ts
src/agent/agent-loop.ts
src/llm/response-parser.ts
```

基础 Agent Loop：

```text
User
 ↓
LLM
 ↓
Tool Call
 ↓
Tool Executor
 ↓
Observation
 ↓
LLM
 ↓
Tool / Final Answer
```

Agent Loop 使用 `maxSteps` 控制最大执行轮数，避免模型无限调用 Tool。

---

# Day 3：Memory

核心文件：

```text
src/memory/types.ts
src/memory/extractor.ts
src/memory/policy.ts
src/memory/store.ts
src/memory/selector.ts
```

处理流程：

```text
User Message
   ↓
Memory Extractor
   ↓
MemoryCandidate
   ↓
Policy
   ↓
Store / Merge
   ↓
Relevant Memory Selection
   ↓
Context
```

Memory 模块负责记忆提取、写入策略、合并和上下文选择。

---

# Day 4：Mini RAG / Retrieval

核心文件：

```text
src/rag/documents.ts
src/rag/chunk.ts
src/rag/embedding.ts
src/rag/similarity.ts
src/rag/retriever.ts
src/rag/context.ts
```

检索链路：

```text
Document
  ↓
Chunk
  ↓
Embedding
  ↓
Index

Question
  ↓
Embedding
  ↓
Metadata Filter
  ↓
Cosine Similarity
  ↓
Top K
  ↓
Context
```

当前教学项目使用本地 Hash Embedding，重点是先把完整 Retrieval Pipeline 跑通。

---

# Day 5：MCP

核心文件：

```text
src/mcp/mini-server.ts
src/mcp/mini-client.ts
src/mcp/catalog.ts
src/mcp/tool-router.ts
src/mcp/executor.ts
```

调用关系：

```text
Server
  ↓ listTools()
Tool Catalog
  ↓
Tool Selection
  ↓
Client.callTool()
  ↓
Server Handler
```

仓库还保留了官方 MCP SDK 示例：

```text
official-mcp-example/
```

---

# Day 6：Workflow / Durable Execution

核心文件：

```text
src/workflow/types.ts
src/workflow/nodes.ts
src/workflow/transitions.ts
src/workflow/runner.ts
src/workflow/retry.ts
src/workflow/errors.ts
src/workflow/persistence.ts
src/workflow/approval.ts
```

主要能力：

```text
State
Node / Transition
Retry
Idempotency
Persistence
Human-in-the-loop
```

这里开始明确区分：

```text
开放式判断 → Agent / Planner
确定性业务过程 → Workflow
```

有副作用、需要审批、重试和幂等的流程，不应该完全交给模型自由决定。

---

# Day 7：Planning / Reflection / Guardrail

核心文件：

```text
src/planning/types.ts
src/planning/policy.ts
src/planning/planner.ts
src/planning/executor.ts
src/planning/action-key.ts
src/planning/reflection.ts
src/planning/run-planner.ts
src/demos/planning-demo.ts
docs/day7-planning.md
```

执行链：

```text
Goal
 ↓
Planner
 ↓
Action
 ↓
Reflection / Policy
 ↓
Executor
 ↓
Observation
 ↓
State Update
 └────────→ Planner
```

Day 7 的 Planner 仍然是规则驱动版，重点先建立 Action Space、Reflection 和 Guardrail。

运行：

```bash
npm run build
npm run demo:day7
```

---

# Day 8：LLM Planner / Validation / Re-planning

核心文件：

```text
src/planning/schema.ts
src/planning/validation.ts
src/planning/llm-planner.ts
src/planning/reflection.ts
src/planning/run-planner.ts
src/demos/day8-llm-planner-demo.ts
docs/day8-llm-planner.md
```

Day 8 把 Planner 真正接到 LLM：

```text
Goal + PlannerState
        ↓
     LLMPlanner
        ↓
     callLLM()
        ↓
Structured Output
        ↓
Runtime Validation
        ↓
Reflection / Policy
        ↓
Executor
        ↓
Observation
        └────────→ Re-planning
```

这里最重要的边界是：

```text
Structured Output Schema
≠
Runtime Permission / Validation
```

模型可以提出非法 Action，但非法 Action 不能进入 Executor。

运行：

```bash
npm run build
npm run demo:day8
```

---

# Day 9：Multi-Agent / Delegation / Permission Boundary

Day 9 开始从 Single Agent 进入 Multi-Agent，但不是简单让多个 Agent 相互聊天，而是先建立职责和权限边界。

核心文件：

```text
src/multi-agent/types.ts
src/multi-agent/customer-analysis-agent.ts
src/multi-agent/copywriting-agent.ts
src/multi-agent/coordinator.ts
src/multi-agent/delegation-runtime.ts
src/multi-agent/agent-registry.ts
src/multi-agent/delegation-guard.ts
src/demos/multi-agent-demo.ts
docs/day9-multi-agent-boundary.md
```

基础链路：

```text
Coordinator
  ↓ DelegationTask
Delegation Guard
  ↓
Delegation Runtime
  ↓
Specialist Agent
  ↓ DelegationResult
CoordinatorState
```

当前 Registry 中包含：

```text
coordinator
customer-analysis
copywriting
```

其中 `customer-analysis` 当前拥有：

```text
search_customer
search_chat_history
search_knowledge
```

而 Coordinator 本身不直接拥有这些业务 Tool。

核心原则：

```text
Coordinator / LLM 可以提出委派
Runtime 决定这个委派是否允许
```

运行：

```bash
npm run build
npm run demo:day9
```

---

# Day 10：Agent Routing

Day 9 中 Coordinator 已经能做受控 Delegation，Day 10 继续去掉写死的 `toAgentId`，让系统根据 Goal 从 Agent Registry 中选择合适的 Specialist Agent。

核心文件：

```text
src/multi-agent/agent-selection.ts
src/multi-agent/agent-router.ts
src/multi-agent/agent-registry.ts
src/multi-agent/coordinator.ts
src/multi-agent/delegation-guard.ts
docs/day10-agent-routing.md
```

路由链路：

```text
Goal
 ↓
Agent Registry
 ↓
Agent Router
 ↓
Structured AgentSelection
 ↓
validateAgentSelection()
 ↓
DelegationTask
 ↓
Delegation Guard
 ↓
Target Agent
```

当前 Router 会把候选 Agent 的：

```text
id
role
description
```

提供给 LLM，然后只接受结构化的 `AgentSelection`。

选择结果仍然不能直接执行，必须经过：

```text
validateAgentSelection()
Delegation Guard
Tool Permission
```

所以：

```text
LLM 决定“建议选谁”
程序决定“这个 Agent 是否存在、是否能被委派、拥有什么权限”
```

---

# Day 11：Agent Evaluation / Regression

Day 11 开始把“看起来能跑”升级为“可以重复验证”。

核心文件：

```text
src/evaluation/types.ts
src/evaluation/routing-cases.ts
src/evaluation/routing-evaluator.ts
src/demos/routing-eval-demo.ts
docs/day11-agent-evaluation.md
docs/day11-evaluation-regression.md
```

第一阶段先评 Agent Routing：

```text
Goal
 ↓
Router
 ↓
Actual Agent
 ↓
Expected Agent
 ↓
PASS / FAIL
 ↓
Accuracy
```

运行：

```bash
npm run build
npm run eval:routing
```

回归流程：

```text
线上失败 / 新边界 Case
  ↓
分类失败原因
  ↓
加入永久 Eval Case
  ↓
修 Router / Policy
  ↓
重新运行数据集
  ↓
Case 永久保留
```

当前评测层与生产 Runtime 分离：

```text
src/multi-agent   → 生产行为
src/evaluation    → 测试样本、期望结果、评分
```

---

# Day 12：Trajectory Evaluation

Day 11 评的是：

```text
Goal → Expected Agent
```

Day 12 开始评：

```text
Goal
 ↓
Agent
 ↓
Tool
 ↓
Observation
 ↓
Final Answer
```

也就是 Agent 的完整执行路径。

核心文件：

```text
src/agent/agent-loop.ts
src/evaluation/trajectory-types.ts
src/evaluation/trajectory-evaluator.ts
src/evaluation/trajectory-cases.ts
src/demos/trajectory-eval-demo.ts
docs/day12-trajectory-evaluation.md
docs/day12-trajectory-instrumentation.md
docs/day12-trajectory-regression.md
```

`runAgentLoop()` 当前已经正式返回：

```ts
trajectory: {
  goal,
  events,
  totalSteps
}
```

Trajectory 记录四类事件：

```text
llm_turn
tool_call
tool_result
final_answer
```

Tool Call / Tool Result 通过 `toolCallId` 建立关联。

当前 Evaluator 可以检查：

```text
requiredTools
forbiddenTools
maxSteps
```

运行：

```bash
npm run build
npm run eval:trajectory
```

当前 Regression Fixtures 同时覆盖：

```text
合理轨迹 → PASS
调用禁止 Tool send_message → FAIL
```

这一步开始明确区分：

```text
Final Answer 正确
≠
Agent 执行路径合理
```

---

# Day 13：Tracing / Observability

Day 12 的 Trajectory 更关注：

```text
Agent 做了什么？
```

Day 13 的 Trace 更关注：

```text
这次运行在哪里花了时间？
哪一步失败？
这些调用属于哪一次请求？
调用之间是什么父子关系？
```

当前已新增：

```text
src/observability/trace-types.ts
docs/day13-tracing-observability.md
```

第一版 Trace Contract：

```text
AgentTrace
TraceSpan
TraceSpanKind
TraceSpanStatus
```

`TraceSpan` 当前包含：

```text
traceId
spanId
parentSpanId
name
kind
startTime
endTime
durationMs
status
attributes
error
```

基本关系：

```text
Trace
└── Agent Span
    ├── LLM Span
    ├── Tool Span
    ├── LLM Span
    └── Tool Span
```

这里需要特别注意：**Day 13 早课目前只是 Contract。**

当前仓库还没有把 `TraceRecorder` 真正接入 `runAgentLoop()`，也还没有实际生成完整 Agent Trace。这是 Day 13 下一阶段要继续完成的内容。

目标演进：

```text
Agent Runtime
     ↓
Trajectory + Trace
     ↓
Evaluation
     ↓
Metrics
     ↓
Observability
```

---

# Trajectory 和 Trace 的区别

```text
Trajectory = 行为轨迹
Trace      = 运行轨迹
```

Trajectory 典型问题：

```text
调用了哪些 Tool？
有没有调用禁止 Tool？
有没有漏掉必要 Tool？
走了多少 Step？
```

Trace 典型问题：

```text
整个请求耗时多少？
哪一次 LLM 最慢？
哪个 Tool 最慢？
哪一步失败？
一次请求中的调用如何关联？
```

未来这两套数据会一起支撑 Evaluation、Debug、Metrics、Cost Analysis 和 Observability。

---

# 关键代码位置

## LLM

```text
src/llm/
```

## Tool Calling / Agent Loop

```text
src/tools/
src/agent/
```

## Memory

```text
src/memory/
```

## RAG

```text
src/rag/
```

## MCP

```text
src/mcp/
official-mcp-example/
```

## Workflow

```text
src/workflow/
```

## Planning

```text
src/planning/
```

## Multi-Agent

```text
src/multi-agent/
```

## Evaluation

```text
src/evaluation/
```

## Observability

```text
src/observability/
```

## Demo / Eval Runner

```text
src/demos/
```

## Production Agent

```text
src/app/production-agent.ts
```

---

# 当前可运行命令

```bash
npm run build
npm run demo
npm run demo:day7
npm run demo:day8
npm run demo:day9
npm run eval:routing
npm run eval:trajectory
```

---

# 当前阶段总结

现在这套项目已经不再只是：

```text
Prompt → LLM → Answer
```

而是在逐步形成一套真正的 Agent Runtime：

```text
Goal
 ↓
Router / Planner / Coordinator
 ↓
Validation / Guardrail / Permission
 ↓
Agent / Tool / Workflow
 ↓
Observation
 ↓
Trajectory / Trace
 ↓
Evaluation / Regression
```

下一步会继续推进 Day 13：

```text
TraceRecorder
→ Agent Root Span
→ LLM Span
→ Tool Span
→ durationMs
→ status / error
```

然后再逐步接入更标准的 Observability 方案。