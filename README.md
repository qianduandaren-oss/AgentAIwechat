# Agent AI 工程师 · Day 1–32 TypeScript 实战项目

这是 Agent AI 工程师课程的代码仓库。项目持续演进同一套 TypeScript Agent Runtime，而不是每天新建孤立 Demo。

当前课程代码进度：**Day 32 早课**。

## 当前 Production Runtime 主链

```text
User Request
↓
Runtime Lifecycle
↓
Run Admission / Bounded Queue / Backpressure
↓
Queue Timeout / Queued Cancellation
↓
Agent Loop
↓
Run Budget / Budget Policy
↓
Cost-aware Model Router
↓
Provider Circuit Breaker
↓
Timeout + Same-provider Retry
↓
Reliability Fallback
↓
Tool Permission / Authorization / Human Approval
↓
Idempotency / Audit
↓
Tracing / Token / Cost
↓
Structured Result
```

统一生产入口：`src/runtime/production-runtime.ts`。

## Deployment Boundary 当前进度

Day 29–31 已完成 Run Admission、Bounded Queue、Backpressure、Queue Timeout、queued AbortSignal cancellation、Runtime Lifecycle 与 Graceful Drain。Runtime 当前支持 `RUNNING → DRAINING → STOPPED`，进入 draining 后停止新准入、清理 queued Runs，并等待 active Runs 自然完成。

当前边界必须明确：Running Cancellation 尚未端到端传播到 Agent Loop / LLM / Tool；Graceful Drain 已有 Runtime 语义，但 Process / HTTP Server shutdown adapter 尚待实现；Metrics、CI/CD 与部署运营闭环仍待补齐。

### Day 32 起点

Day 32 从 Process / Server Shutdown Adapter 继续：把 SIGTERM/SIGINT、HTTP Server 停止接入和 `runtime.drain()` 串成薄适配层，不把业务关闭逻辑塞进进程事件。

## 运行

```bash
npm install
npm run build
npm run test:run-admission
npm run test:lifecycle
npm run test:readiness
npm run test:circuit-breaker
npm run test:reliability-fallback
npm run test:model-routing
```

具体阶段设计与课程说明见 `docs/`。
