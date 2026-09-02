# Day 12 午练：Trajectory Instrumentation

在现有 `runAgentLoop()` 上增加结构化轨迹记录，不改变 Agent 决策语义。

当前记录四类事件：`llm_turn`、`tool_call`、`tool_result`、`final_answer`。`AgentLoopResult` 新增 `trajectory`，供 Evaluation / Tracing 复用。

`evaluateTrajectory()` 第一版检查三项：

- `requiredTools`：必须出现的工具
- `forbiddenTools`：禁止出现的工具
- `maxSteps`：最大执行步数

原则：Runtime 负责产生事实，Evaluator 负责判断这些事实是否符合预期。