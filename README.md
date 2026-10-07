# Agent AI 工程师 · Day 1–46 TypeScript 实战项目

这是 Agent AI 工程师学习过程里的持续演进代码仓库。

项目不是每天新建一个孤立 Demo，而是围绕同一套 TypeScript Agent Runtime 不断往生产级方向补能力：从最早的 LLM 调用、Tool Calling、Planner、Multi-Agent，到后面的 Evaluation、Tracing、Budget、安全、可靠性、优雅停机、Cancellation，以及现在的 Durable Execution / Recovery。

当前课程代码进度：**Day 46**。

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
Persistent / Transactional Checkpoint Store
↓
Recovery Coordinator
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

## Day 1～44 能力演进

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

# Day 35～41：Durable Agent Runtime

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

## Day 40～41：Persistent / Transactional Checkpoint

Day 40 让 Checkpoint 第一次离开 `new Map()`：

```text
FileCheckpointStore
↓
write temporary file
↓
rename
↓
new Store instance
↓
load checkpoint
```

它验证的是：

```text
Process / Store Restart
↓
Checkpoint 仍然存在
```

Day 41 进一步把 CAS 语义下沉到共享存储 Contract：

```text
TransactionalCheckpointStore
↓
insertIfAbsent
updateIfVersion
↓
Storage-level atomic compare + write
```

同时新增 `CheckpointRecoveryCoordinator`，把：

```text
Conflict
↓
reload
↓
re-plan
```

正式封装进 Recovery Runtime。

相关实现：

```text
src/runtime/checkpoint-recovery-coordinator.ts
src/runtime/file-checkpoint-store.ts
src/runtime/transactional-checkpoint-store.ts

src/demos/checkpoint-recovery-coordinator-test.ts
src/demos/persistent-checkpoint-test.ts
src/demos/transactional-checkpoint-test.ts
```

重要边界仍然保留：当前仓库还没有真正连接 PostgreSQL/SQLite，因此生产级跨进程 CAS 由 `TransactionalCheckpointDatabase` Contract 表达，还需要后续数据库 Adapter 落地。

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
│   ├── file-checkpoint-store.ts
│   ├── transactional-checkpoint-store.ts
│   ├── checkpoint-recovery-coordinator.ts
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
npm run test:checkpoint-recovery
npm run test:persistent-checkpoint
npm run test:transactional-checkpoint
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
↓
Checkpoint Conflict Recovery
↓
Persistent Checkpoint Restart/CAS
↓
Transactional Multi-instance CAS
```

当前最新代码已经通过以上检查。

---

# 当前边界

现在这套代码已经开始具备 Production Runtime 的骨架，但还没有把所有问题都做完。

目前明确没有假装完成的部分：

### 1. 已有 File 持久化原型，但生产数据库 Adapter 还没接入

当前已经有：

```text
InMemoryCheckpointStore
FileCheckpointStore
TransactionalCheckpointStore
```

其中 `FileCheckpointStore` 用于验证 Restart Contract：新的 Store 实例仍能读回 Checkpoint；它只在同一 Node.js 进程内串行化文件读写，**不冒充跨进程原子 CAS**。

`TransactionalCheckpointStore` 已把生产级存储需要的原子语义抽象出来：

```text
insertIfAbsent
updateIfVersion
```

下一步仍需要接入真正的：

```text
PostgreSQL / SQLite
```

由共享存储执行原子的 Conditional Update。

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


---

## Day 42～44：SQLite、Recovery Observability 与人工恢复

这一阶段把 Durable Agent 从“能恢复”继续推进到“能持久化、能观测、能运营”。

核心链路：

```text
SQLite-backed Checkpoint
↓
Crash Recovery
↓
Recovery Event
↓
Metrics / Suspended Runs
↓
RecoveryOperationService
↓
Authorization + Audit
↓
Checkpoint Version + Control Version
↓
quarantine / release / resume / dead-letter
```

Day 44 额外引入独立的 Operational Control Version。它和 `checkpoint.version` 解决的是两个不同维度的并发问题：

```text
checkpoint.version
→ Runtime 状态是否过期

control.version
→ 运营控制状态是否过期
```

人工操作仍然不能直接调用副作用 Tool。所有 retry / reconcile / resume 都必须重新进入 Recovery Coordinator，由 ToolEffectPolicy、Reconciler、Idempotency 和 CAS 共同决定下一步。

对应实现：

```text
src/runtime/recovery-operations.ts
src/runtime/recovery-metrics.ts
src/runtime/suspended-run-registry.ts

src/demos/recovery-operations-test.ts
src/demos/recovery-operation-lifecycle-test.ts
```


## Day 45：Durable Command + Outbox

Human Recovery 继续从“有操作按钮”推进到“命令本身可恢复”。

新增：

- Durable Recovery Command Record：稳定 commandId、状态机和 version/OCC
- In-memory Command Store：insertIfAbsent + updateIfVersion
- Recovery Outbox：pending / dispatched、attempts、version
- Outbox Dispatcher：按 at-least-once 语义重试投递
- Consumer Idempotency：通过 eventId / commandId 抵抗重复事件

当前 Day 45 午练仍然是 Contract / In-memory Prototype，用来验证命令幂等与 Outbox 重投语义；它还没有冒充数据库事务。下一步会把 RecoveryOperationService、Checkpoint / Control 变化、Command Record 与 Outbox Record 放进同一个 SQLite/PostgreSQL 事务边界。


## Day 46：Prepare / Commit 分离

Day 45 已经有 SQLite Recovery Finalization Unit of Work。Day 46 开始把 Recovery 决策和持久化提交拆开：

```text
Prepare
→ Planner / Reconciler
→ PreparedRecoveryTransition
→ 不写数据库

Commit
→ expected versions
→ Checkpoint / Control / Command / Outbox
→ 单事务落库
```

Morning 新增 `src/runtime/recovery-preparation.ts`，先建立 persistence-free preparation contract。它保留 observed checkpoint version，计算 next checkpoint，但不自行递增版本或保存状态。后续会逐步把 Coordinator / RecoveryOperationService 接到这一边界。


---

## Day 46：Prepare / Commit + Transaction-aware Committer

Recovery 现在开始把“决策”和“持久化提交”拆开：

```text
CheckpointRecoveryCoordinator
↓
prepareRecoveryTransition()
↓
PreparedRecoveryTransition
↓
RecoveryTransitionCommitter
```

默认 Committer 仍可使用 `CheckpointStore`，而 SQLite 事务版本通过：

```text
src/runtime/sqlite-recovery-transition-committer.ts
```

桥接到 Day 45 的 `SQLiteRecoveryFinalizationUnitOfWork`。

一次需要持久化的恢复现在可以把：

```text
Checkpoint
+ Recovery Control
+ Durable Command
+ Outbox
```

放进同一个 SQLite Transaction 中提交。

对应回归测试：

```text
npm run test:recovery-preparation
npm run test:recovery-committer
npm run test:sqlite-recovery-committer
```

注意：复合事务的冲突可能来自 checkpoint / control / command / outbox。只有 checkpoint-only conflict 适合在 Coordinator 内部直接 reload + re-prepare；复合冲突需要更外层的 Human Recovery Orchestrator 重新加载整组事实。


## Day 47：Durable Recovery Operation Orchestrator

Day 47 开始把 Durable Command、Human Recovery 和 Day 46 的事务化 Commit 组装成一条可重复调用、可崩溃恢复的命令处理链。

Morning 先固定 command identity 与 replay 语义：

```text
commandId 不存在
→ accept_new

terminal command
→ replay_terminal
→ 不重新执行 Recovery

accepted / executing
→ resume_in_flight
→ 重新读取事实后恢复，不盲目重放 handler
```

新增：

```text
src/runtime/durable-recovery-operation-orchestrator.ts
docs/day47-durable-recovery-operation-orchestrator.md
```

同时 Durable Command Record 增加可选 `resultSnapshot` Contract，为后续稳定重放 terminal response 做准备。
