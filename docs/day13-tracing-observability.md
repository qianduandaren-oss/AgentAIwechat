# Day 13：Tracing / Observability

Day 12 已经让 Agent Loop 输出 Trajectory，用于评测“路径是否合理”。Day 13 建立 Trace，用于回答一次运行具体发生了什么、哪一步慢、哪一步失败。

## Trajectory 与 Trace

- Trajectory：面向 Agent 语义行为，例如 llm_turn、tool_call、tool_result、final_answer。
- Trace：面向运行观测，例如 traceId、spanId、parentSpanId、startTime、endTime、durationMs、status。
- Evaluation 消费运行事实并判断质量；Observability 保存并组织运行事实，帮助定位问题。

## 当前实现

```text
src/observability/trace-types.ts
src/observability/trace-recorder.ts
src/observability/trace-summary.ts
src/agent/agent-loop.ts
src/demos/day13-tracing-demo.ts
```

`TraceRecorder` 已经接入 `runAgentLoop()`：

```text
agent.run
├── llm.turn.1
├── tool.search_customer
├── llm.turn.2
└── ...
```

LLM / Tool 的成功、异常和耗时都会写入 Span。`TraceSummary` 继续汇总：

```text
totalDurationMs
llmCalls
toolCalls
errorCount
slowestSpan
```

Day 14 又在 LLM Span 上继续加入 Token Usage 与 estimatedCostUsd，使 Trace 不只是“哪里慢”，也能回答“哪里贵”。

## Demo

```bash
npm run demo:day13
```

脚本会先执行 TypeScript build，再运行 tracing demo。
