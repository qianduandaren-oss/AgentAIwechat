# Day 13：Tracing / Observability

Day 12 已经让 Agent Loop 输出 Trajectory，用于评测“路径是否合理”。Day 13 开始建立 Trace：用于回答一次运行具体发生了什么、哪一步慢、哪一步失败。

## Trajectory 与 Trace

- Trajectory：面向 Agent 语义行为，例如 llm_turn、tool_call、tool_result、final_answer。
- Trace：面向运行观测，例如 traceId、spanId、parentSpanId、startTime、endTime、durationMs、status。
- Evaluation 消费运行事实并判断质量；Observability 保存并组织运行事实，帮助定位问题。

## 第一版 Trace Contract

`src/observability/trace-types.ts` 定义 `AgentTrace` 与 `TraceSpan`。Span 分为 agent / llm / tool 三类。后续将在 Agent Loop 中加入 instrumentation，并保持业务决策逻辑不变。

## 下一步

午练将实现轻量 TraceRecorder，把一次 Agent 请求组织为 root agent span、LLM spans 和 tool spans，并计算 durationMs 与错误状态。
