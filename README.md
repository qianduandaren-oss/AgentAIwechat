# Agent AI 工程师 · Day 1–39 TypeScript 实战项目

这是 Agent AI 工程师学习过程里的持续演进代码仓库。

项目不是每天新建一个孤立 Demo，而是围绕同一套 TypeScript Agent Runtime 不断往生产级方向补能力：从最早的 LLM 调用、Tool Calling、Planner、Multi-Agent，到后面的 Evaluation、Tracing、Budget、安全、可靠性、优雅停机、Cancellation，以及现在的 Durable Execution / Recovery。

当前课程代码进度：**Day 39**。

---

## 现在这套 Runtime 已经做到什么程度

目前主链已经从“能跑 Agent”推进到了“开始考虑生产环境里的失败、取消、重复执行和恢复”。

```text
User Request
↓
Runtime Lifecycle
↓
Run Admission / Bounded Queue / Backpressure
↓
Queue Timeout / Cancellation
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
Tool Effect Policy
↓
Idempotency / Audit
↓
Durable Tool Execution
↓
Checkpoint + Version / CAS
↓
Recovery Planner
↓
Reconciler
↓
Tracing / Token / Cost
↓
Structured Result
```

统一生产入口：

```text
src/runtime/production-runtime.ts
```

---

## Day 1～39 能力演进

### 1. Agent 基础

前面的课程先把 Agent 最基本的运行骨架搭起来：

- 统一的 LLM Provider 抽象
- `callLLM`
- Tool Calling
- Tool Registry / Executor
- Agent Loop
- Structured Output
- Planner / Action / Observation
- Reflection / Guardrail
- Multi-Agent Routing / Delegation

这些代码最终都不是独立存在，而是逐步汇入当前 Runtime。

---

### 2. Evaluation 与 Observability

Agent 能跑以后，开始解决“怎么知道它跑得好不好”。

目前已经包含：

- Routing Evaluation
- Trajectory Evaluation
- Trace Recorder
- Trace Summary
- Token Usage
- Cost Calculation
- Budget Guard
- Run Budget
- Budget Policy

核心思路是：不能只看最终回答，还要看 Agent 中间到底做了什么。

---

### 3. Security

目前 Tool 执行已经不再是模型说调就直接调。

现在包含：

- Tool Permission
- Authorization
- Human Approval
- Audit Log
- Idempotency
- Prompt Injection Guard
- Sensitive Data Sanitization
- Tool Result Sanitization
- Tool Effect Policy

其中 Day 35 开始增加 Tool 的副作用语义：

```text
none
internal_write
external_side_effect
```

并显式描述：

- 是否允许安全重试
- 是否必须使用 idempotency key
- 是否存在补偿机制
- 副作用是否可恢复

对应实现：

```text
src/security/tool-effect-policy.ts
src/security/secure-tool-executor.ts
src/security/idempotency.ts
```

---

## Cancellation：现在已经真正穿透到执行链

之前 Runtime 只能取消 queued Run，但 Running Run 内部仍可能继续执行。

目前已经补齐这条链：

```text
AbortSignal
↓
Production Runtime
↓
Agent Loop
↓
LLM Invoker
↓
Retry / Fallback
↓
LLM Provider

AbortSignal
↓
Agent Loop
↓
Tool Executor
↓
Secure Tool Executor
↓
Tool Handler
```

也就是说，现在取消发生以后：

- 不再继续发起新的 Agent Step
- 不再继续 Retry
- 不再切换 Fallback Provider
- Tool Handler 可以收到 `AbortSignal`
- Secure Tool 也能收到取消信号

相关代码：

```text
src/runtime/llm-invoker.ts
src/runtime/reliability-fallback.ts
src/security/secure-tool-executor.ts
src/tools/executor.ts
src/agent/agent-loop.ts
```

---

# Day 35～39：Durable Agent Runtime

这几天的重点已经从“失败以后抛异常”转向：

> Agent 执行到一半挂了以后，系统怎么知道之前到底执行到了哪里？

## 1. Tool Effect Policy

不是所有 Tool 都可以简单 Retry。

例如：

```text
search_customer
```

失败以后通常可以重新查。

但：

```text
send_message
execute_refund
create_order
```

如果请求已经发出，只是客户端没收到结果，就不能直接再执行一次。

因此 Runtime 现在会先判断 Tool 的副作用性质。

---

## 2. Durable Tool Executor

核心实现：

```text
src/runtime/durable-tool-executor.ts
```

执行 Tool 时不再只有：

```text
execute()
↓
result
```

而是：

```text
Persist Intent
↓
Execute Tool
↓
Persist Outcome
```

Tool 的执行状态目前可以记录为：

```text
never_executed
started
executed
failed
unknown
cancelled_before_execution
```

其中最重要的是：

```text
unknown
```

它代表：

> Tool 可能已经执行，也可能没有执行，Runtime 当前无法直接确定。

这也是 Durable Agent 必须解决的问题。

---

## 3. Checkpoint

Checkpoint 定义在：

```text
src/runtime/checkpoint.ts
src/runtime/checkpoint-store.ts
```

Checkpoint 会记录：

- Run ID
- 当前 Step
- Resume Boundary
- Tool Execution Record
- Idempotency Key
- Tool Outcome
- Version
- Updated Time

当前 Resume Boundary 包括：

```text
ready_for_llm
ready_for_tool
waiting_approval
reconciling_tool
ready_for_next_step
completed
```

---

## 4. Version + CAS

Day 39 开始解决另一个问题：

> 如果两个恢复进程同时修改同一个 Checkpoint 怎么办？

当前 `CheckpointStore` 已加入 Version / Compare-And-Swap 语义。

写入时必须提供：

```text
expectedVersion
```

如果当前版本和调用方预期不一致，会抛出：

```text
CheckpointConflictError
```

这样可以避免旧状态把新状态覆盖掉。

当前实现：

```text
InMemoryCheckpointStore
```

这里要特别说明：

**目前还不是数据库持久化。**

现在完成的是：

```text
Checkpoint Model
+
Version
+
CAS
+
Recovery Contract
```

下一阶段再把这套接口接到 PostgreSQL / SQLite / Redis 等真正的进程外存储。

---

## 5. Recovery Planner

实现：

```text
src/runtime/recovery-planner.ts
```

恢复逻辑不会让 LLM 自己猜，而是由确定性的 Runtime Policy 决定。

当前 Recovery Action：

```text
skip
retry
reconcile
suspend
```

大致语义：

| 状态 | 处理方式 |
| --- | --- |
| 已确认执行成功 | skip |
| 已确认没执行，且安全重试 | retry |
| 有副作用但执行结果未知 | reconcile |
| 无法安全判断 | suspend |

原则很简单：

> 不确定的时候，不重复制造副作用。

---

## 6. Reconciler

实现：

```text
src/runtime/reconciler.ts
src/runtime/recovery-runtime.ts
```

对于支付、退款、创建订单、发消息这类外部副作用 Tool，单靠本地状态并不足以判断它是否已经执行。

因此需要通过业务系统再次查询真实状态。

例如：

```text
execute_refund
↓
网络超时
↓
本地不知道退款是否成功
↓
Reconciler 查询支付系统
↓
executed / never_executed / unknown
```

然后再交给 Recovery Planner 决定：

```text
skip / retry / suspend
```

---

# 当前 Durable Execution 主链

```text
Tool Call
↓
Tool Effect Policy
↓
Persist started
↓
Secure Tool Executor
↓
Tool Handler
↓
Persist executed / failed / unknown
↓
CheckpointStore
↓
Version / CAS
↓
Process Restart / Recovery
↓
Recovery Planner
↓
Reconciler
↓
skip / retry / reconcile / suspend
```

这一阶段的重点已经不再是“Tool 能不能调通”，而是：

> Tool 调到一半发生故障后，系统还能不能安全地继续。

---

# Deployment Boundary

目前 Deployment Runtime 已包含：

- Run Admission
- Bounded Queue
- Backpressure
- Queue Timeout
- Queued Cancellation
- Running Cancellation
- Runtime Lifecycle
- Graceful Drain
- SIGTERM / SIGINT Adapter
- Shutdown Coordinator
- Shutdown Deadline
- Shutdown Escalation
- Readiness Validation
- Circuit Breaker
- Reliability Fallback

Runtime 生命周期：

```text
RUNNING
↓
DRAINING
↓
STOPPED
```

进入 `DRAINING` 后：

- 停止接收新的 Run
- 清理 queued Runs
- 等待 active Runs
- Process Signal Adapter 负责接入 SIGTERM / SIGINT
- Shutdown Deadline 控制最长优雅关闭时间

---

# 项目目录

```text
src/
├── agent/
│   └── agent-loop.ts
│
├── llm/
│   ├── client.ts
│   ├── types.ts
│   └── providers/
│
├── tools/
│   ├── registry.ts
│   ├── executor.ts
│   └── types.ts
│
├── planning/
├── multi-agent/
├── evaluation/
├── observability/
│
├── security/
│   ├── secure-tool-executor.ts
│   ├── tool-permission.ts
│   ├── tool-effect-policy.ts
│   ├── authorization-service.ts
│   ├── approval-store.ts
│   ├── idempotency.ts
│   ├── audit-log.ts
│   └── prompt-injection-guard.ts
│
├── runtime/
│   ├── production-runtime.ts
│   ├── llm-invoker.ts
│   ├── resilience.ts
│   ├── reliability-fallback.ts
│   ├── provider-circuit-breaker.ts
│   ├── run-admission-controller.ts
│   ├── runtime-lifecycle.ts
│   ├── run-budget.ts
│   ├── budget-policy.ts
│   ├── checkpoint.ts
│   ├── checkpoint-store.ts
│   ├── durable-tool-executor.ts
│   ├── recovery-planner.ts
│   ├── reconciler.ts
│   └── recovery-runtime.ts
│
└── demos/
```

---

# 本地运行

安装依赖：

```bash
npm install
```

编译：

```bash
npm run build
```

运行基础 Demo：

```bash
npm run demo
```

---

# Runtime 测试

常用测试：

```bash
npm run test:runtime-contract
npm run test:runtime-integration

npm run test:model-routing
npm run test:reliability-fallback
npm run test:circuit-breaker
npm run test:readiness

npm run test:run-admission
npm run test:lifecycle

npm run test:shutdown
npm run test:signal-shutdown
npm run test:shutdown-deadline
npm run test:shutdown-escalation

npm run test:running-cancellation
npm run test:inflight-cancellation
npm run test:resilient-cancellation

npm run test:durable-recovery
```

---

# CI

仓库已经配置：

```text
.github/workflows/runtime-tests.yml
```

当前 CI 会验证：

```text
TypeScript Build
↓
Runtime Contract
↓
Production Runtime Integration
↓
Resilient Cancellation
↓
Durable Recovery
```

当前最新代码已经通过以上检查。

---

# 当前边界

现在这套代码已经开始具备 Production Runtime 的骨架，但还没有把所有问题都做完。

目前明确没有假装完成的部分：

### 1. Checkpoint 还没有真正持久化到数据库

目前：

```text
InMemoryCheckpointStore
```

接下来应该实现：

```text
PostgreSQL / SQLite / Redis Adapter
```

让 Agent 在：

```text
Process Crash
Container Restart
Server Restart
```

之后还能读取之前的 Checkpoint。

### 2. Recovery 还需要真正接入业务 Tool

目前 Recovery / Reconciler 的 Runtime Contract 已经有了。

后面需要逐步给真实 Tool 实现：

```text
PaymentReconciler
RefundReconciler
OrderReconciler
MessageReconciler
```

### 3. 还需要继续补生产环境运营能力

例如：

- Persistent Checkpoint
- Metrics
- Recovery Dashboard
- Dead Letter / Suspended Run 管理
- Distributed Lock
- Multi-instance Recovery
- 更完整的 CI/CD
- Production Deployment

---

# 这套项目现在在解决什么

如果只看前几天，Agent 很像：

```text
LLM + Tools + Loop
```

但随着课程继续推进，Runtime 已经逐渐变成：

```text
Agent Runtime
=
Reasoning
+ Tool Execution
+ Security
+ Observability
+ Budget
+ Reliability
+ Cancellation
+ Lifecycle
+ Durable Execution
+ Recovery
```

这也是这个仓库后续继续演进的主线。

具体阶段设计和课程说明见：

```text
docs/
```
