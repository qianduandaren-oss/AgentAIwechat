# 代码地图

```text
src/
├── index.ts                       # 一键运行入口
├── demos/full-demo.ts             # Day 1-6 全链路演示
│
├── llm/
│   ├── client.ts                  # callLLM()
│   ├── response-parser.ts         # extractToolCalls / extractText / extractStructured
│   ├── types.ts
│   └── providers/mock-provider.ts
│
├── day1/
│   └── lead-analyzer.ts           # Structured Output
│
├── tools/
│   ├── registry.ts                # Day 2 local Tool Registry
│   ├── executor.ts
│   └── implementations.ts
│
├── agent/
│   ├── agent-loop.ts              # Reason → Act → Observe
│   ├── router.ts                  # Memory / RAG / Workflow routing
│   └── context-builder.ts
│
├── memory/
│   ├── extractor.ts
│   ├── policy.ts
│   ├── selector.ts
│   ├── store.ts
│   └── types.ts
│
├── rag/
│   ├── documents.ts
│   ├── chunk.ts
│   ├── embedding.ts
│   ├── similarity.ts
│   ├── retriever.ts
│   └── context.ts
│
├── mcp/
│   ├── mini-server.ts
│   ├── mini-client.ts
│   ├── catalog.ts
│   ├── tool-router.ts
│   ├── executor.ts
│   └── servers/
│       ├── crm-server.ts
│       └── calendar-server.ts
│
├── workflow/
│   ├── types.ts
│   ├── nodes.ts
│   ├── transitions.ts
│   ├── runner.ts
│   ├── retry.ts
│   ├── errors.ts
│   ├── persistence.ts
│   └── approval.ts
│
├── app/
│   └── production-agent.ts        # 前 6 天最终整合
│
└── shared/
    └── utils.ts
```
