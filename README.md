# Agent AI 工程师 · Day 1–8 完整可运行项目

这是 Agent AI 工程师课程 Day 1–8 的 TypeScript 实战代码。项目不是每天新建一个孤立 Demo，而是在同一套 Agent Runtime 上持续演进，目前已经覆盖：

```text
LLM / Structured Output
→ Tool Calling / Agent Loop
→ Memory
→ RAG
→ MCP
→ Workflow / Durable Execution
→ Planning / Reflection
→ LLM Planner / Validation / Re-planning
```

## 运行方式

直接运行主项目：

```bash
node dist/index.js
```

修改 TypeScript 源码后：

```bash
npm install
npm run build
npm run demo
```

单独运行 Day 7 Planning / Reflection：

```bash
npm run demo:day7
```

单独运行 Day 8 LLM Planner / Validation / Re-planning：

```bash
npm run demo:day8
```

---

## Day 1–8 学习路线

```text
Day 1  LLM / Structured Output
  ↓
Day 2  Tool Calling / Agent Loop
  ↓
Day 3  Memory / Context
  ↓
Day 4  RAG / Retrieval
  ↓
Day 5  MCP / Capability Discovery
  ↓
Day 6  Workflow / State / Retry / Idempotency / HITL
  ↓
Day 7  Planning / Action Space / Reflection / Guardrail
  ↓
Day 8  LLM Planner / Validation / Re-planning
```

当前整体结构：

```text
                          Memory
                            ↑
                            │
User → Router → Context Builder ← RAG
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

核心原则一直没有变：

```text
LLM 负责提出判断和下一步建议
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

主要函数：

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
LeadResult
```

`callLLM()` 是统一 LLM 调用入口，业务层不直接依赖某一家模型 SDK。

项目默认使用 `MockLLMProvider`，方便不用 API Key 也能直接运行和调试课程代码。

---

# Day 2：Function Calling、Tool Use 与 Agent Loop

核心文件：

```text
src/tools/registry.ts
src/tools/executor.ts
src/tools/implementations.ts
src/agent/agent-loop.ts
src/llm/response-parser.ts
```

执行链：

```text
User
 ↓
callLLM()
 ↓
extractToolCalls()
 ↓
executeTool()
 ↓
Tool Result
 ↓
写回 messages
 ↓
callLLM()
 ↓
Tool / Final Answer
```

示例任务：

```text
查一下张三，
如果他是高意向客户，
明天下午 3 点提醒我跟进。
```

工具调用过程：

```text
search_customer
      ↓
Observation
      ↓
create_reminder
      ↓
Observation
      ↓
Final Answer
```

Agent Loop 使用 `maxSteps` 控制最大执行轮数，防止模型无限调用工具。

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

示例：

```text
以后尽量下午联系我
```

保存为：

```text
contactTime = afternoon
```

Memory 模块负责记忆提取、存储策略、合并和上下文选择。

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

检索流程：

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

`embedding.ts` 使用本地 Hash Embedding：

```text
text → number[] → cosine similarity
```

RAG 模块当前已经包含：

```text
Document
Chunk
Embedding
Metadata Filter
Similarity
Top K
Context Builder
```

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

项目中还包含官方 MCP SDK 示例：

```text
official-mcp-example/
```

主要使用：

```text
@modelcontextprotocol/server
@modelcontextprotocol/client
serveStdio()
StdioClientTransport
```

目录说明：

```text
src/mcp/               MCP 核心运行流程
official-mcp-example/  官方 TypeScript SDK 示例
```

---

# Day 6：Workflow / 状态机 / Durable Execution

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

业务流程：

```text
LOAD_CUSTOMER
      ↓
CHECK_INTENT
      ↓
 high ?
   ├─ No → DONE
   ↓ Yes
CHECK_FOLLOWUP
      ↓
 exists ?
   ├─ Yes → DONE
   ↓ No
CREATE_FOLLOWUP
      ↓
WRITE_LOG
      ↓
SEND_NOTIFICATION
      ↓
DONE
```

主要能力：

### State

记录 Workflow 当前节点和业务数据。

### Node / Transition

```text
Node       = 执行当前步骤
Transition = 决定下一步
Runner     = 驱动流程执行
```

### Retry

通过 `TransientWorkflowError` 和 Retry 机制处理临时错误。

### Idempotency

```text
idempotencyKey
```

用于避免相同副作用操作被重复执行。

### Human-in-the-loop

```text
WAITING_APPROVAL
reviewApproval()
assertApproved()
```

用于需要人工确认的业务节点。

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
docs/checkpoints/week-01.md
```

执行链：

```text
Goal → Planner → Action → Reflection / Policy
     → Executor → Observation → State Update → Planner
```

当前 Action Space：

```text
search_customer
search_chat_history
search_knowledge
finish
```

Day 7 的 `CustomerPlanner` 还是规则版 Planner：下一步动作由程序根据 Observation 写死。

`createActionKey()` 为 Action 创建指纹，`reflectAction()` 会在执行前拦截重复 Tool Call。拒绝原因写入 `reflectionNotes`，供 Planner 下一轮调整决策。

真实副作用操作不直接开放给 Planner，例如：

```text
send_message
create_reminder
update_customer
delete_customer
charge_payment
refund_order
```

这些操作应该交给 Workflow 处理权限、审批、重试和幂等。

运行验收：

```bash
npm run build
npm run demo:day7
```

Demo 同时覆盖正常规划闭环和重复 Action 防护；重复查询最终只会执行一次。

---

# Day 8：LLM Planner / Structured Output / Validation / Re-planning

Day 8 把 Day 7 的规则版 Planner 真正接回前面已经实现的 LLM 基础设施。

核心文件：

```text
src/llm/types.ts
src/llm/providers/mock-provider.ts
src/planning/schema.ts
src/planning/validation.ts
src/planning/llm-planner.ts
src/planning/reflection.ts
src/planning/run-planner.ts
src/demos/day8-llm-planner-demo.ts
docs/day8-llm-planner.md
```

完整执行链：

```text
Goal + PlannerState
        ↓
     LLMPlanner
        ↓
     callLLM()
        ↓
Structured Output
        ↓
parsePlannerAction()
        ↓
Plan Validation
   ├─ invalid → 带错误反馈重新请求模型
   └─ valid
        ↓
Reflection / Policy
        ↓
Executor
        ↓
Observation
        ↓
Reflection Note
        └────────→ 下一轮 LLMPlanner
```

## 08:00：Planner Structured Output

`LLMTask` 新增：

```text
planner_next_action
```

`LLMRequest` 增加：

```text
responseSchema
```

`src/planning/schema.ts` 定义 Planner 的输出契约，目前模型只能从下面四类动作中选择：

```text
search_customer
search_chat_history
search_knowledge
finish
```

这里需要特别区分：

```text
Structured Output Schema = 约束模型输出形状
Validation / Policy       = 真正的程序安全边界
```

即使模型返回了 JSON，也不能因为 TypeScript 写了泛型就直接相信它。

## 12:00：LLMPlanner + Runtime Validation

`LLMPlanner.planNext()` 每一轮会读取：

```text
goal
observations
reflectionNotes
validationFeedback
allowed action space
```

然后执行：

```text
callLLM()
  ↓
extractStructured()
  ↓
parsePlannerAction()
  ↓
assertActionAllowed()
```

`parsePlannerAction()` 会在运行时检查：

```text
type 是否存在
Action 是否在白名单
input 是否为对象
name / customerId / query / answer 是否有效
```

例如模型返回：

```json
{
  "type": "send_message",
  "input": {
    "customerId": "C001",
    "text": "直接发消息"
  }
}
```

这个结果会在进入 Executor 前被拒绝。

LLMPlanner 会把失败原因写进 `validationFeedback`，再次请求模型生成合法 Action，这就是最小 Re-planning。

## 18:00：Observation Reflection + Re-planning

Day 7 的 Reflection 主要检查重复 Action。

Day 8 又增加了 Observation 检查：

```text
null
undefined
空字符串
空对象
```

这类结果不会被当成有效证据，而是形成 Reflection Note，继续进入下一轮 Planner。

`runPlanner()` 也支持可配置：

```text
maxSteps
```

默认仍然是 6，避免 Planner 因不断重新规划进入无限循环。

## Day 7 和 Day 8 的关键区别

```text
Day 7
Planner 下一步由程序写死
        ↓
CustomerPlanner
        ↓
Action

Day 8
Planner 下一步由模型根据 State 动态生成
        ↓
LLMPlanner
        ↓
callLLM()
        ↓
Structured Output
        ↓
Validation
        ↓
Action
```

所以 Day 8 之后，Planner 才真正开始具备：

```text
根据 Observation 决定下一步
根据失败原因重新规划
根据 Reflection 调整下一轮决策
```

运行验收：

```bash
npm run build
npm run demo:day8
```

正常执行路径：

```text
search_customer
→ search_chat_history
→ search_knowledge
→ finish
```

Validation Demo 会故意让 Provider 第一次返回非法 `send_message`。

最终应该看到：

```text
Executor received: search_customer -> search_chat_history -> search_knowledge
Invalid send_message reached executor: false
```

这证明：

```text
模型可以提出非法动作
但非法动作不会真正执行
```

---

# 为什么 Day 8 仍然使用 MockLLMProvider

课程当前已经走完整的 Provider 调用链：

```text
LLMPlanner
 ↓
callLLM()
 ↓
LLMProvider.generate()
 ↓
Structured Output
```

默认使用 `MockLLMProvider` 是为了让仓库不依赖 API Key 也能稳定运行。

后续接真实模型时，只需要增加新的 Provider：

```text
OpenAIProvider
AnthropicProvider
DoubaoProvider
...
```

只要实现：

```ts
interface LLMProvider {
  generate(request: LLMRequest): Promise<unknown>;
}
```

Planning、Memory、Agent Loop 等上层代码不需要因为更换模型而重写。

---

# 当前 Production Agent

核心文件：

```text
src/app/production-agent.ts
```

Day 1–6 已经形成：

```text
Message
 ↓
Memory Extraction / Write Policy
 ↓
Router
 ├─ Memory
 ├─ RAG
 └─ Workflow
       ↓
      MCP
```

Day 7–8 新增的 Planning Runtime 当前仍然保持相对独立，方便学习每一层职责。

后续会逐步把：

```text
LLMPlanner
Validation
Reflection
Re-planning
```

接入 `ProductionAgent` 的开放式分析路径。

几个典型任务现在可以这样理解：

```text
我之前说什么时候联系方便？
→ Memory

PLC 课程退费规则是什么？
→ RAG

查一下张三，如果他是高意向客户，明天下午提醒我跟进
→ Workflow + LLM + MCP + Retry + Idempotency

分析张三为什么一直没成交，并根据查询结果决定下一步还查什么
→ LLM Planning + Observation + Validation + Reflection
```

---

# 关键代码位置

## LLM

```text
src/llm/client.ts
src/llm/response-parser.ts
src/llm/types.ts
src/llm/providers/
```

## Tool Calling

```text
src/tools/
src/agent/agent-loop.ts
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
src/planning/types.ts
src/planning/policy.ts
src/planning/planner.ts
src/planning/action-key.ts
src/planning/reflection.ts
src/planning/run-planner.ts
```

## Day 8 LLM Planning

```text
src/planning/schema.ts
src/planning/validation.ts
src/planning/llm-planner.ts
src/demos/day8-llm-planner-demo.ts
docs/day8-llm-planner.md
```

## 最终 Agent

```text
src/app/production-agent.ts
```

---

# 推荐阅读顺序

如果你准备把前 8 天的代码完整串一次，建议按下面顺序看：

```text
1.  src/llm/types.ts
2.  src/llm/client.ts
3.  src/llm/response-parser.ts
4.  src/llm/providers/mock-provider.ts
5.  src/day1/lead-analyzer.ts
6.  src/tools/
7.  src/agent/agent-loop.ts
8.  src/memory/
9.  src/rag/
10. src/mcp/
11. src/workflow/
12. src/planning/types.ts
13. src/planning/policy.ts
14. src/planning/planner.ts
15. src/planning/action-key.ts
16. src/planning/reflection.ts
17. src/planning/run-planner.ts
18. src/planning/schema.ts
19. src/planning/validation.ts
20. src/planning/llm-planner.ts
21. src/demos/day8-llm-planner-demo.ts
22. src/app/production-agent.ts
23. src/demos/full-demo.ts
```

这样可以完整看到这套项目是怎么从：

```text
调用一次 LLM
```

逐步演进到：

```text
LLM
+ Tool
+ Memory
+ RAG
+ MCP
+ Workflow
+ Planner
+ Validation
+ Reflection
+ Re-planning
```

后面的课程会继续在这一个仓库上演进，不重新另起一套互不相关的 Demo。
