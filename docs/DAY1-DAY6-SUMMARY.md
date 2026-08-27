# Day 1–6 阶段总结

## 一句话看懂这 6 天

前 6 天不是在学习 6 个 AI 名词，而是在逐层回答一个问题：**怎样把“调用模型”变成一个可控、可记忆、可查知识、可执行动作、可恢复的 Agent 系统。**

| Day | 核心问题 | 最终能力 |
|---|---|---|
| Day 1 | 怎样让 LLM 输出进入程序？ | Structured Output |
| Day 2 | 怎样让模型不只回答，还能行动？ | Tool Calling + Agent Loop |
| Day 3 | Agent 为什么“记住”？ | Memory + Context Management |
| Day 4 | Agent 怎样访问模型参数之外的知识？ | RAG + Retrieval |
| Day 5 | 外部能力越来越多时怎么标准化连接？ | MCP + Tool Discovery |
| Day 6 | 哪些事情能交给 Agent，哪些必须程序控制？ | Workflow + State + Retry + Idempotency + HITL |

## Day 1 → Day 2

Day 1 的关键不是 JSON，而是：

```text
LLM 输出
→ Data Contract
→ Business Logic
```

Day 2 在这层基础上增加：

```text
LLM
→ Tool Call
→ Program Executes Tool
→ Observation
→ LLM
```

这里 `callLLM()` 和 `extractToolCalls()` 是 Agent Runtime 最底层的桥。

## Day 2 → Day 3

Agent Loop 只能解决当前任务，不能解释“为什么下次还知道用户下午方便”。

所以加入：

```text
Store → Retrieve → Select → Inject Context
```

Memory 不是“模型自己记住了”，而是应用层重新注入。

## Day 3 → Day 4

Memory 适合用户长期信息，但不应该拿来存整个企业知识库。

于是分成：

```text
用户长期信息 → Memory
外部业务知识 → RAG
```

RAG 的本质不是 Vector DB，而是 Retrieval：找到当前问题真正需要的知识，再进入 Context。

## Day 4 → Day 5

当 Agent 开始有 CRM、Calendar、GitHub、Database 等大量外部能力，如果每个 Agent 都手写 Adapter，会产生 N×M 集成问题。

MCP 引入标准能力边界：

```text
Host / Client / Server
Tools / Resources / Prompts
Capability Discovery
```

同时必须区分：

```text
Tool Discovery ≠ Tool Selection
```

Catalog 里可以有 100 个 Tool，本轮模型未必应该看到 100 个。

## Day 5 → Day 6

MCP 解决“怎么连接能力”，却不解决“什么时候允许调用”。

所以引入 Workflow：

```text
State + Node + Edge/Transition
```

并把 LLM 缩到真正需要智能判断的节点里。

进一步进入生产问题：

```text
Retry
Idempotency
Checkpoint / Resume
Human-in-the-loop
```

最重要的工程判断是：

```text
理解 / 分类 / 搜索 / 规划
→ LLM / Agent

付款 / 退款 / 删除 / 状态变更 / 审批 / 重试
→ Program / Workflow
```

## 当前作品集项目能力

这份压缩包已经形成一个 `ProductionAgent` 雏形，具备：

- 结构化输出；
- 多轮 Tool Calling；
- Agent Loop + maxSteps；
- Memory Extract / Policy / Store / Select；
- Mini RAG：Chunk / Embedding / Cosine / Metadata / Top K；
- MCP 风格 Tool Discovery / Catalog / Routing / Execute；
- Workflow State / Node / Transition；
- Retry + Exponential Backoff；
- Idempotency Key；
- Human Approval Guard；
- Memory / RAG / Workflow 的统一 Router。

## 现在还需要巩固的点

1. 用真实模型 SDK 替换 Mock Provider 后，不同供应商 Tool Call Response 的 Adapter 怎么写。
2. RAG 的 Chunking、真实 Embedding、Metadata、Rerank 与 Evaluation。
3. MCP 官方 SDK 与我们教学 Runtime 的协议层差异。
4. Workflow 的真正持久化、进程重启 Resume、并发与分布式锁。
5. Tool 权限、审批和副作用安全边界。

这些也是后续课程继续往生产 Agent 走的基础。
