# Agent AI 工程师 · Day 1–7 完整可运行项目

这是 Agent AI 工程师课程 Day 1–7 的 TypeScript 实战代码，内容覆盖 LLM、Structured Output、Tool Calling、Agent Loop、Memory、RAG、MCP、Workflow、Planning 等核心能力。

## 运行方式

直接运行已编译代码：

```bash
node dist/index.js
```

修改 TypeScript 源码后：

```bash
npm install
npm run build
npm run demo
```

---

## Day 1–7 学习内容

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
Day 7  Planning / Action Space / Policy / Observation
```

整体结构：

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
  │    Planning
  │       ↓
  │     Policy
  │       ↓
  │    Executor
  │       ↓
  │   Tool / MCP
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

`callLLM()` 负责统一 LLM 调用入口，Provider 层负责具体模型实现。

项目默认使用 `MockLLMProvider`，方便直接运行和调试课程代码。

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

Agent Loop 通过 `maxSteps` 控制最大执行轮数。

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

RAG 模块包含：

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
src/mcp/              MCP 核心运行流程

official-mcp-example/ 官方 TypeScript SDK 示例
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

# Day 7：Planning / Action Space / Policy

核心文件：

```text
src/planning/types.ts
src/planning/policy.ts
src/planning/planner.ts
src/planning/executor.ts
docs/day7-planning.md
```

Planning 循环：

```text
Goal
 ↓
Planner
 ↓
Action
 ↓
Policy 校验
 ↓
Executor
 ↓
Observation
 ↓
State Update
 ↓
Planner
```

核心原则：

```text
LLM 决定“做什么”
程序决定“允许做什么”
```

当前 Planner Action Space：

```text
search_customer
search_chat_history
search_order
search_knowledge
create_followup_plan
finish
```

真实副作用操作不直接开放给 Planner，例如：

```text
create_reminder
send_message
update_customer
delete_customer
refund_order
```

这些动作应该进入 Workflow，由程序处理权限、审批、重试和幂等。

当前 `Planner` 使用可注入的 `PlanningDecisionProvider`：

```text
AgentState
   ↓
PlanningDecisionProvider
   ↓
PlanningDecision
```

后续可以把 Provider 接到现有 `callLLM()`，让模型根据 Observation 动态决定下一步 Tool。

---

# 最终整合 Agent

核心文件：

```text
src/app/production-agent.ts
```

Day 1–6 的整体调用关系：

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

Day 7 新增的 Planning 层目前保持独立，下一步会接入 Production Agent 的开放式分析路径。

示例：

```text
我之前说什么时候联系方便？
→ Memory

PLC 课程退费规则是什么？
→ RAG

查一下张三，如果他是高意向客户，明天下午提醒我跟进
→ Workflow + LLM + MCP + Retry + Idempotency

分析张三为什么一直没成交，并根据中间结果决定还要查什么
→ Planning + Observation + Policy
```

---

# 关键代码位置

## LLM

```text
src/llm/client.ts
src/llm/response-parser.ts
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
src/planning/
docs/day7-planning.md
```

## 最终 Agent

```text
src/app/production-agent.ts
```

---

# 推荐阅读顺序

```text
1. src/llm/client.ts
2. src/llm/response-parser.ts
3. src/day1/lead-analyzer.ts
4. src/tools/
5. src/agent/agent-loop.ts
6. src/memory/
7. src/rag/
8. src/mcp/
9. src/workflow/
10. src/planning/types.ts
11. src/planning/policy.ts
12. src/planning/planner.ts
13. src/planning/executor.ts
14. src/app/production-agent.ts
15. src/demos/full-demo.ts
```

按照这个顺序，可以从 LLM 调用开始，一直看到 Tool Calling、Memory、RAG、MCP、Workflow，再进入 Planning。
