# Day 22 Morning — AgentRunResult / StopReason

Production Agent 不应只通过 `throw Error` 向 HTTP、CLI、Worker 暴露运行结果。Day 22 开始建立稳定 Runtime Contract。

主链：

```text
ProductionAgentRuntime.run()
        ↓
AgentRunResult
├─ status
├─ stopReason
└─ result / message
        ↓
HTTP / CLI / Worker Adapter
```

第一版 StopReason：`completed`、`budget_warning`、`budget_exceeded`、`permission_denied`、`deadline_exceeded`、`max_steps_reached`、`runtime_error`。

当前阶段只定义契约，不宣称 ProductionAgentRuntime 已完成所有异常映射。午练继续实现 Error → StopReason 分类，并接入 Runtime 主链。
