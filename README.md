# Agent AI 工程师 · Day 1–6 完整可运行项目

这不是把前 6 天聊天里的代码片段简单复制到一起，而是把缺失的接口补齐后，重新整理成一套连续、可运行、可继续扩展的 TypeScript 工程。

## 先看结论

之前课程里没有真正落地的两个函数，现在都已经补齐：

```text
src/llm/client.ts
└── callLLM()

src/llm/response-parser.ts
├── extractToolCalls()
├── extractText()
└── extractStructured()
```

其中原来教学里出现过的 `extractToolCall()` 被调整为 `extractToolCalls()`，因为真实模型一次响应可能包含多个 Tool Call。

---

## 最快运行方式

压缩包已经包含编译后的 `dist/`，所以**不需要 API Key，也不需要先 npm install**：

```bash
node dist/index.js
```

你会依次看到 Day 1 → Day 6 的完整演示输出。

如果你修改了 TypeScript 源码，再执行：

```bash
npm install
npm run build
npm run demo
```

主教学项目只需要 TypeScript 作为开发依赖。

---

# 前 6 天的真正知识链

```text
Day 1
LLM / Structured Output
      ↓
Day 2
Tool Calling / Agent Loop
      ↓
Day 3
Memory / Context
      ↓
Day 4
RAG / Retrieval
      ↓
Day 5
MCP / Capability Discovery
      ↓
Day 6
Workflow / State / Retry / Idempotency / HITL
```

最终不是 6 个互相独立的 Demo，而是串成：

```text
                          Memory
                            ↑
                            │
User → Router → Context Builder ← RAG
  │
  ├─ 普通问答 → callLLM()
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
          ↓
   External Capability
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

真正补齐的链路：

```text
业务代码
  ↓
callLLM()
  ↓
LLMProvider.generate()
  ↓
原始模型响应
  ↓
extractStructured()
  ↓
LeadResult
```

`callLLM()` 的目的不是增加一层没必要的封装，而是避免 Agent Runtime 直接绑定 OpenAI / Claude / Gemini 某一家 SDK。

教学项目默认使用 `MockLLMProvider`，原因是：你下载后不需要任何模型账号就能把 Agent Runtime 调试完整。生产环境只需要新增真实 Provider，不需要修改 Agent Loop。

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

完整执行链：

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
继续 Tool / Final Answer
```

示例任务：

```text
查一下张三，
如果他是高意向客户，
明天下午 3 点提醒我跟进。
```

实际执行：

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

并且 Agent Loop 有 `maxSteps`，避免无限循环。

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

链路：

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
“以后尽量下午联系我”
```

会保存：

```text
contactTime = afternoon
```

而不是把所有聊天内容都长期保存。

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

完整链：

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

为了让项目无 API Key 运行，`embedding.ts` 用的是**教学版本地 Hash Embedding**。它保留了：

```text
text → number[] → cosine similarity
```

整个接口和 Retriever 结构。

生产环境替换成真实 Embedding API 时，只替换：

```text
src/rag/embedding.ts
```

Retriever、Metadata Filter、Top K 等代码无需重写。

同时代码明确处理：

```text
Similarity ≠ Freshness ≠ Authority
```

所以检索默认过滤 2026 数据，避免 2024 旧制度因为语义更像而胜出。

---

# Day 5：MCP

主项目为了保证一键运行，提供了一套 `MiniMcpServer / MiniMcpClient`：

```text
src/mcp/mini-server.ts
src/mcp/mini-client.ts
src/mcp/catalog.ts
src/mcp/tool-router.ts
src/mcp/executor.ts
```

它不是冒充官方协议实现，而是专门把 MCP 最重要的运行时关系透明化：

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

另外压缩包里单独提供：

```text
official-mcp-example/
```

这是按 2026-08-27 当前官方 TypeScript SDK 结构整理的 stdio 示例，使用：

```text
@modelcontextprotocol/server
@modelcontextprotocol/client
serveStdio()
StdioClientTransport
```

也就是说：

- `src/mcp/`：用于理解底层结构、一键跑通。
- `official-mcp-example/`：用于学习真实 MCP SDK 的接法。

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

当前业务流程：

```text
LOAD_CUSTOMER
      ↓
CHECK_INTENT     ← LLM Node
      ↓
 high ?
   ├─ No → DONE
   ↓ Yes
CHECK_FOLLOWUP   ← MCP / Program Node
      ↓
 exists ?
   ├─ Yes → DONE
   ↓ No
CREATE_FOLLOWUP  ← MCP Side Effect
      ↓
WRITE_LOG        ← 第一次模拟 timeout，再 Retry
      ↓
SEND_NOTIFICATION
      ↓
DONE
```

实现了：

### State

知道当前流程执行到哪里，以及已经产生了什么数据。

### Node / Transition 分离

```text
Node       = 执行当前步骤
Transition = 决定下一步
Runner     = 驱动流程
```

### Retry

`WRITE_LOG` 第一次故意抛出 `TransientWorkflowError`，Runner 会指数退避重试。

### Idempotency

`create_reminder` 使用：

```text
idempotencyKey
```

同一个操作重复调用不会创建多个 Reminder。

### Human-in-the-loop

`approval.ts` 提供：

```text
WAITING_APPROVAL
reviewApproval()
assertApproved()
```

高风险动作在人工批准前会被程序级拦截，而不是只靠 Prompt 说“请先确认”。

---

# 最终整合 Agent

核心文件：

```text
src/app/production-agent.ts
```

这个类把前面的能力真正接了起来：

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

测试：

```text
“我之前说什么时候联系方便？”
→ Memory

“PLC 课程退费规则是什么？”
→ RAG

“查一下张三，如果他是高意向客户，明天下午提醒我跟进”
→ Workflow + LLM + MCP + Retry + Idempotency
```

---

# 你最关心的两个函数在哪里

## callLLM

定义：

```text
src/llm/client.ts
```

使用位置包括：

```text
src/day1/lead-analyzer.ts
src/memory/extractor.ts
src/agent/agent-loop.ts
src/workflow/nodes.ts
src/app/production-agent.ts
```

## extractToolCalls

定义：

```text
src/llm/response-parser.ts
```

主要使用：

```text
src/agent/agent-loop.ts
```

另外同文件还有：

```text
extractText()
extractStructured()
```

因此模型原始响应的解析职责不会散落在业务代码里。

---

# 建议你的阅读顺序

不要直接从 `ProductionAgent` 开始啃。

建议：

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
10. src/app/production-agent.ts
11. src/demos/full-demo.ts
```

这样基本就是把前 6 天重新按代码走一遍。

---

# 重要说明

这份项目的目标是“把 Agent 工程原理真正串起来”，不是包装成生产框架。

因此：

- LLM 默认 Mock，生产替换 Provider。
- Embedding 默认本地教学实现，生产替换 Embedding Model。
- Workflow State Store 默认内存，生产换 Redis/Postgres。
- 主项目 MCP 使用透明的教学实现，真实官方 SDK 示例在 `official-mcp-example/`。
- 没有真的发送消息、付款、退款等外部副作用。

这样你可以先把每一层 Debug 明白，再逐个替换成真实基础设施。
