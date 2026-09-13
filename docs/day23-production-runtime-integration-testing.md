# Day 23 午练：Production Runtime Integration Testing

Day 23 早课先锁住 `Error -> StopReason -> HTTP Status` 的纯函数契约。午练继续向真实生产路径推进：直接通过 `ProductionAgentRuntime.runStructured()` 发起运行，并使用可控的 Mock Provider 验证成功、模型调用预算耗尽和 LLM Timeout 三条路径。

## 主链

```text
Mock Provider
    ↓
ProductionAgentRuntime.runStructured()
    ↓
run()
    ↓
runAgentLoop()
    ↓
Resilient LLM Invoker / AgentRunBudget
    ↓
AgentRunResult
```

## 运行

```bash
npm run test:runtime-integration
```

当前检查：

- 正常文本响应 -> `completed`
- `maxModelCalls=1` 且需要第二次模型调用 -> `budget_exceeded`
- Provider 响应超过 `LLM_TIMEOUT_MS` -> `deadline_exceeded`

这组检查的重点不是测试某个 Mapper，而是确认 Production Runtime 的真实装配路径仍然遵守 Day 22 建立的结构化运行契约。
