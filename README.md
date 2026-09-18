# Agent AI 工程师 · Day 1–28 TypeScript 实战项目

这是 Agent AI 工程师课程的代码仓库。

这套项目不是每天新建互不相关的 Demo，而是在同一套 TypeScript Agent Runtime 上持续演进：LLM / Structured Output → Tool Calling → Memory → RAG → MCP → Workflow → Planning / Reflection → Multi-Agent → Evaluation → Tracing / Observability → Security → Production Runtime → Budget / Cost Routing → Reliability Fallback → Circuit Breaker → Runtime Readiness。

当前课程代码进度：**Day 28 / Week 4 完成**。

## 当前 Production Runtime 主链

```text
User Request
↓
Trust Boundary / Sensitive Data Guard
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

## Week 4 / Day 22–28 Checkpoint

这一阶段重点已经从“Agent 能不能完成任务”转向“Agent Runtime 在线上失败时是否仍然可预测”。当前已经形成 Run Budget、Closing Mode、Cost-aware Model Routing、Reliability Fallback、Provider Circuit Breaker 和 Runtime Readiness Validation 的连续生产链路。

当前边界也必须明确：Provider Health 仍然是进程内状态；readiness 当前主要是静态 Runtime 配置校验，不等于外部 Provider 网络健康；仓库虽有 Integration Test，但还需要把 build/test 真正接进 CI；并发、Backpressure、Graceful Shutdown、Metrics/SLI/SLO 仍属于下一阶段。

### Day 29 起点

从 Day 29 继续，不重复前面内容。下一阶段从 Deployment Boundary 开始，优先补并发控制 / Backpressure、Graceful Shutdown、Health / Readiness Endpoint、Metrics 与 CI/CD，再把当前 Runtime 收成一个真正可部署、可演示的完整 Agent 项目。

## 运行

```bash
npm install
npm run build
npm run test:readiness
npm run test:circuit-breaker
npm run test:reliability-fallback
npm run test:model-routing
```

具体阶段设计与课程说明见 `docs/`。