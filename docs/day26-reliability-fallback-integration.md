# Day 26 午练：Reliability Fallback Integration

目标：在已有同 Provider Retry 之后，增加一次有边界的跨 Provider Fallback。

执行顺序：

```text
Cost Route
→ selected provider
→ resilient retry on same provider
→ classify final error
→ recoverable? fallback once : throw
```

第一版允许 fallback 的错误：timeout、429/rate limit、5xx/temporary unavailable、network/connection。

第一版明确禁止用 fallback 掩盖的错误：401/403、API Key、permission、400/invalid request、schema/validation。

新增 `src/runtime/reliability-fallback.ts` 负责故障分类和单次 fallback；`ProductionAgentRuntime` 继续负责装配，并记录 `model.fallback.<task>` Trace Span。Cost Routing 与 Reliability Routing 的原因保持分离。

验证命令：

```bash
npm run test:reliability-fallback
```

Integration Test 检查两条路径：429 在同 Provider retry 一次后切 fallback 并完成；401 不 retry、不 fallback，保持失败结果。
