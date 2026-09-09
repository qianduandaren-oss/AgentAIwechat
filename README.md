# Agent AI 工程师 · Day 1–19 TypeScript 实战项目

这是 Agent AI 工程师课程的代码仓库。

这套项目不是每天新建一个互不相关的 Demo，而是在同一套 TypeScript Agent Runtime 上持续演进：从最基础的 LLM 调用，一路推进到 Tool Calling、Memory、RAG、Planning、Multi-Agent、Evaluation、Observability、安全边界和 Production Runtime。

当前课程代码进度：**Day 19**。

---

## 一、现在这套 Agent 已经走到哪里

```text
LLM / Structured Output
        ↓
Tool Calling / Agent Loop
        ↓
Memory / Context
        ↓
RAG / Retrieval
        ↓
MCP / Capability Discovery
        ↓
Workflow / Durable Execution
        ↓
Planning / Reflection / Guardrail
        ↓
LLM Planner / Validation / Re-planning
        ↓
Multi-Agent / Delegation
        ↓
Agent Routing
        ↓
Evaluation / Regression
        ↓
Trajectory Evaluation
        ↓
Tracing / Observability
        ↓
Token / Cost / Budget
        ↓
Permission / Human Approval / Idempotency
        ↓
Authorization / Audit
        ↓
Prompt Injection / Trust Boundary
        ↓
Sensitive Data Boundary
        ↓
Runtime Config / Timeout / Retry
        ↓
Production Agent Runtime
```

核心原则一直没有变：

```text
LLM 负责：
判断、规划、选择、提出下一步动作

程序负责：
校验、权限、状态、审批、幂等、重试、成本和安全边界
```

---

## 二、当前 Production Runtime 主链

现在 `runAgentLoop()` 已经不再是最早期的裸循环：

```text
User Request
    ↓
Trust Boundary / System Instruction
    ↓
Agent Loop
    ↓
LLM Call
    ├── Trace Span
    ├── Token Usage
    ├── Cost
    └── Budget Guard
    ↓
Tool Call
    ↓
Permission Policy
    ↓
Authorization
    ↓
Human Approval（高风险动作）
    ↓
Idempotency Guard
    ↓
Tool Execute
    ↓
Sensitive Data Sanitizer
    ↓
Audit Trail
    ↓
Observation
    └────────────→ Agent Loop
```

统一生产运行入口：

```text
src/runtime/production-runtime.ts
```

它负责把 Day 13～19 的能力统一接进 Agent Runtime。

---

## 三、运行方式

安装依赖：

```bash
npm install
```

编译：

```bash
npm run build
```

运行主项目：

```bash
npm run demo
```

### Planning / Multi-Agent

```bash
npm run demo:day7
npm run demo:day8
npm run demo:day9
```

### Evaluation

```bash
npm run eval:routing
npm run eval:trajectory
```

### Day 13～15 专项 Demo

```bash
npm run demo:day13
npm run demo:day14
npm run demo:day15
```

这三个命令会先执行 TypeScript build，再运行对应 Demo。

### Day 16～19 专项 Demo

```bash
npm run demo:authorization-audit
npm run demo:prompt-injection
npm run demo:safe-tool-result
npm run demo:data-leakage
npm run demo:runtime-config
npm run demo:resilience
```

---

## 四、Day 1～19 学习路线

| Day | 主题 | 主要解决的问题 |
| --- | --- | --- |
| Day 1 | LLM / Structured Output | 程序怎样稳定消费模型输出 |
| Day 2 | Tool Calling / Agent Loop | 模型怎样提出动作并进入多轮执行 |
| Day 3 | Memory / Context | Agent 怎样记住并重新取回用户信息 |
| Day 4 | RAG / Retrieval | Agent 怎样访问模型参数之外的知识 |
| Day 5 | MCP | 怎样把外部能力做成可发现、可调用的 Tool |
| Day 6 | Workflow | 状态、重试、持久化、幂等、HITL |
| Day 7 | Planning | Goal → Action → Observation → Re-plan |
| Day 8 | LLM Planner | 用真实 LLM 做 Planner，并做运行时校验 |
| Day 9 | Multi-Agent | Coordinator、Specialist、Delegation Boundary |
| Day 10 | Agent Routing | 根据 Goal 自动选择合适 Agent |
| Day 11 | Evaluation | 把“看起来能跑”变成可回归验证 |
| Day 12 | Trajectory | 评估 Agent 实际执行路径是否合理 |
| Day 13 | Tracing | 看清一次 Agent Run 里哪里慢、哪里错 |
| Day 14 | Token / Cost | 记录 Token、估算成本并设置 Budget |
| Day 15 | Permission / Approval | 高风险 Tool 不再默认自动执行 |
| Day 16 | Authorization / Audit | 谁、通过哪个 Agent、能对什么资源做什么 |
| Day 17 | Prompt Injection | 区分可信指令与不可信外部内容 |
| Day 18 | Sensitive Data | 控制敏感数据进入 LLM / Log 的边界 |
| Day 19 | Production Runtime | Runtime Config、Timeout、Retry 与统一运行入口 |

---

# Day 1：LLM API 与 Structured Output

核心文件：

```text
src/llm/client.ts
src/llm/response-parser.ts
src/llm/providers/mock-provider.ts
src/day1/lead-analyzer.ts
```

基础链：

```text
Business Code
    ↓
callLLM()
    ↓
LLM Provider
    ↓
Raw Response
    ↓
extractStructured()
    ↓
Business Result
```

这一阶段最重要的是先建立：

```text
LLM 输出
→ Data Contract
→ Runtime Validation
→ Business Logic
```

---

# Day 2：Tool Calling / Agent Loop

核心文件：

```text
src/tools/registry.ts
src/tools/executor.ts
src/tools/implementations.ts
src/agent/agent-loop.ts
```

基础循环：

```text
User
 ↓
LLM
 ↓
Tool Call
 ↓
Executor
 ↓
Observation
 ↓
LLM
 ↓
Final Answer / Next Tool
```

`maxSteps` 用于限制 Agent 无限循环。

---

# Day 3：Memory / Context

核心文件：

```text
src/memory/types.ts
src/memory/extractor.ts
src/memory/policy.ts
src/memory/store.ts
src/memory/selector.ts
```

链路：

```text
User Message
   ↓
Memory Extractor
   ↓
Memory Candidate
   ↓
Policy
   ↓
Store / Merge
   ↓
Relevant Selection
   ↓
Context
```

关键边界：

```text
Memory ≠ 全量聊天历史
Context ≠ 越长越好
```

---

# Day 4：RAG / Retrieval

核心文件：

```text
src/rag/documents.ts
src/rag/chunk.ts
src/rag/embedding.ts
src/rag/similarity.ts
src/rag/retriever.ts
src/rag/context.ts
```

检索链：

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
Filter
  ↓
Similarity
  ↓
Top K
  ↓
Context
```

教学项目使用本地 Hash Embedding，重点先理解完整 Retrieval Pipeline。

---

# Day 5：MCP / Capability Discovery

核心文件：

```text
src/mcp/mini-server.ts
src/mcp/mini-client.ts
src/mcp/catalog.ts
src/mcp/tool-router.ts
src/mcp/executor.ts
```

仓库同时保留：

```text
official-mcp-example/
```

用于对照官方 MCP SDK。

---

# Day 6：Workflow / Durable Execution

核心文件：

```text
src/workflow/types.ts
src/workflow/nodes.ts
src/workflow/transitions.ts
src/workflow/runner.ts
src/workflow/retry.ts
src/workflow/persistence.ts
src/workflow/approval.ts
```

这一阶段开始明确：

```text
开放式判断 → Agent / Planner
确定性业务流程 → Workflow
```

副作用、审批、重试、持久化、幂等，不应该完全交给 LLM 自由决定。

---

# Day 7：Planning / Reflection / Guardrail

核心文件：

```text
src/planning/types.ts
src/planning/planner.ts
src/planning/executor.ts
src/planning/policy.ts
src/planning/reflection.ts
src/planning/run-planner.ts
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
 └────────→ Planner
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
```

关键边界：

```text
Structured Output
≠
Runtime Permission
```

模型可以提出动作，但非法动作不能直接进入 Executor。

---

# Day 9：Multi-Agent / Delegation

核心文件：

```text
src/multi-agent/agent-registry.ts
src/multi-agent/coordinator.ts
src/multi-agent/delegation-runtime.ts
src/multi-agent/delegation-guard.ts
src/multi-agent/customer-analysis-agent.ts
src/multi-agent/copywriting-agent.ts
```

```text
Coordinator
  ↓
Delegation Guard
  ↓
Specialist Agent
  ↓
Delegation Result
```

---

# Day 10：Agent Routing

核心文件：

```text
src/multi-agent/agent-selection.ts
src/multi-agent/agent-router.ts
src/multi-agent/agent-registry.ts
```

模型负责“建议选谁”，程序负责验证：

```text
这个 Agent 是否存在？
是否允许被委派？
是否真的拥有对应能力？
```

---

# Day 11：Agent Evaluation / Regression

核心文件：

```text
src/evaluation/types.ts
src/evaluation/routing-cases.ts
src/evaluation/routing-evaluator.ts
```

目标：

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
```

线上失败 Case 可以沉淀成永久回归数据。

---

# Day 12：Trajectory Evaluation

核心文件：

```text
src/evaluation/trajectory-types.ts
src/evaluation/trajectory-evaluator.ts
src/evaluation/trajectory-cases.ts
src/agent/agent-loop.ts
```

Trajectory 关注：

```text
llm_turn
tool_call
tool_result
final_answer
```

当前可以检查：

```text
requiredTools
forbiddenTools
maxSteps
```

---

# Day 13：Tracing / Observability

核心文件：

```text
src/observability/trace-types.ts
src/observability/trace-recorder.ts
src/observability/trace-summary.ts
src/demos/day13-tracing-demo.ts
```

一次 Agent Run 现在可以形成：

```text
agent.run
├── llm.turn.1
├── tool.search_customer
├── llm.turn.2
└── ...
```

Trace Summary 可汇总：

```text
totalDurationMs
llmCalls
toolCalls
errorCount
slowestSpan
```

---

# Day 14：Token / Cost / Budget

核心文件：

```text
src/observability/token-usage.ts
src/observability/model-pricing.ts
src/observability/budget-guard.ts
src/demos/day14-cost-budget-demo.ts
```

运行链：

```text
LLM Response
  ↓
Token Usage
  ↓
Model Pricing
  ↓
Estimated Cost
  ↓
Budget Guard
```

支持：

```text
maxTokens
maxCostUsd
```

Provider 没有 usage 时会使用估算值，并标记：

```text
source = estimated
```

---

# Day 15：Permission / Human Approval / Idempotency

核心文件：

```text
src/security/tool-permission.ts
src/security/approval-store.ts
src/security/idempotency.ts
src/security/secure-tool-executor.ts
src/demos/day15-permission-approval-demo.ts
```

完整链：

```text
Tool Call
  ↓
Permission
  ├── allowed
  ├── denied
  └── approval_required
          ↓
      PendingAction
          ↓
      Human Approval
          ↓
      Idempotency
          ↓
      Tool Execute
```

人工批准的是被冻结的 Action Snapshot，不是让模型审批后重新生成参数。

---

# Day 16：Authorization / Audit Trail

核心文件：

```text
src/security/authorization-types.ts
src/security/authorization-service.ts
src/security/audit-log.ts
src/demos/authorization-audit-demo.ts
```

一次权限判断：

```text
Actor
+
Agent
+
Action
+
Resource
↓
authorize()
↓
ALLOW / DENY
```

这里同时体现 RBAC + Resource Scope / ABAC。

关键顺序：

```text
Permission
↓
Authorization
↓
Approval
```

没有基础权限，不能靠人工 Approval 强行绕过。

---

# Day 17：Prompt Injection / Trust Boundary

核心文件：

```text
src/security/trust-boundary.ts
src/security/prompt-injection-guard.ts
src/security/safe-tool-result.ts
src/demos/prompt-injection-guard-demo.ts
src/demos/safe-tool-result-demo.ts
```

核心思路：

```text
System / Runtime Policy
→ trusted instruction

User / RAG / Web / Tool Result
→ untrusted data
```

外部内容可以作为证据，但不能自动升级为 Runtime Policy。

---

# Day 18：Sensitive Data / Data Leakage Boundary

核心文件：

```text
src/security/sensitive-data.ts
src/security/data-leakage-policy.ts
src/demos/data-leakage-boundary-demo.ts
```

新增两类清洗：

```text
sanitizeForLog()
sanitizeForLLM()
```

处理范围包括：

```text
API Key / Token / Password
PII
Phone
Business Sensitive Data
```

原则：

```text
能不进 LLM 的敏感数据，就不要先进去再补救。
```

---

# Day 19：Runtime Config / Timeout / Retry / Production Runtime

核心文件：

```text
src/config/runtime-config.ts
src/runtime/resilience.ts
src/runtime/llm-invoker.ts
src/runtime/production-runtime.ts
src/demos/runtime-config-demo.ts
src/demos/resilience-demo.ts
```

Runtime Config 负责把生产参数从业务代码中拆出来，例如：

```text
LLM timeout
max retries
```

Resilience 提供：

```text
withTimeout()
withRetry()
```

统一入口 `ProductionAgentRuntime` 把 Day 13～19 的能力组合起来：

```text
Tracing
Token / Cost
Budget
Permission
Authorization
Approval
Idempotency
Audit
Trust Boundary
Sensitive Data
Timeout / Retry
```

这意味着课程已经从“会写一个 Agent Demo”开始进入真正的 Runtime 工程阶段。

---

## 五、核心目录

```text
src/
├── agent/              Agent Loop / Context / Router
├── config/             Runtime Configuration
├── day1/               Structured Output 示例
├── demos/              各阶段可运行 Demo
├── evaluation/         Routing / Trajectory Evaluation
├── llm/                LLM Provider / Client / Parser
├── mcp/                MCP Client / Server / Catalog / Executor
├── memory/             Memory Extract / Policy / Store / Select
├── multi-agent/        Coordinator / Routing / Delegation
├── observability/      Trace / Token / Cost / Budget
├── planning/           Planner / Reflection / Validation
├── rag/                Retrieval Pipeline
├── runtime/            Production Runtime / Resilience
├── security/           Permission / Auth / Audit / Injection / Data
├── tools/              Tool Registry / Executor / Implementations
└── workflow/           Durable Workflow / Retry / Approval
```

---

## 六、文章仓库

每天的早课、午练、晚练文章单独归档在：

```text
qianduandaren-oss/AIAgentAutoArticle
```

分工保持清晰：

```text
AIAgentAutoArticle
→ 看课程正文

AgentAIwechat
→ 看课程代码和 Runtime 演进
```

---

## 七、当前阶段

截至 Day 19，这个仓库已经覆盖：

```text
LLM Application
→ Single Agent
→ Planning Agent
→ Multi-Agent
→ Evaluation
→ Observability
→ Security
→ Production Runtime
```

后续课程继续在这套 Runtime 上演进，不重新开一套孤立工程。
