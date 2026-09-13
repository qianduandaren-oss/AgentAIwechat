# Day 23 早课：Runtime Contract Testing

Day 22 已建立 `AgentRunResult -> HTTP Adapter -> Frontend` 契约。Day 23 开始为这个边界增加契约检查，避免内部重构时悄悄改变 `stopReason` 或 HTTP 映射。

## 当前第一组检查

- steps budget -> `max_steps_reached` -> HTTP 200
- model calls budget -> `budget_exceeded` -> HTTP 200
- timeout -> `deadline_exceeded` -> HTTP 504
- permission denied -> `permission_denied` -> HTTP 403
- unknown error -> `runtime_error` -> HTTP 500

运行：

```bash
npm run test:runtime-contract
```

这仍是轻量、无测试框架的第一版。午练继续把检查从 Error Mapper 扩展到 `ProductionAgentRuntime.runStructured()` 边界。
