# Agent AI 工程师 · Day 36 早课：Durable Execution / Crash Recovery

日期：2026-09-26

Day 35 把副作用、幂等、Compensation 和 Tool Execution Outcome 串了起来。今天进入 Durable Execution：Agent 跑到一半进程崩了，重启后到底应该从哪里继续。

## 今天学什么

普通 Agent Loop 的默认假设是“进程一直活着”：

```text
Step 1 → Step 2 → Tool A → Step 3 → Tool B → Final
```

但线上可能变成：

```text
Step 1 → Tool A 已成功 → Step 2
                     ↓
                  进程崩溃
```

如果重启后直接从 Step 1 重跑，Tool A 可能重复产生副作用。Durable Execution 的核心不是“把 Promise 保存下来”，而是把**可恢复状态**持久化，让新进程能够判断哪些步骤已经确认完成、哪些结果未知、从哪个安全边界继续。

## 核心概念：Checkpoint 不是聊天记录

Checkpoint 至少要回答：

```text
runId
currentStep
messages / state
completed tool calls
tool execution outcome
idempotencyKey
next safe action
checkpoint version
```

只保存 messages 不够。比如消息里写着“准备退款”，并不能证明退款是否已经发生。真正恢复时必须结合 Tool Execution Record。

可以把恢复理解成前端熟悉的状态恢复，但要求更严格：

```text
React state restore
→ 主要恢复 UI

Agent checkpoint restore
→ 恢复执行状态 + 外部副作用事实
```

## 最关键的恢复原则

假设崩溃前：

```text
search_customer   executed
update_customer   executed
execute_refund    unknown
                  ↓
                 crash
```

重启后最危险的写法是：

```text
resume
↓
execute_refund 再跑一次
```

正确逻辑应该先看 outcome：

```text
executed
→ 不重复执行

failed
→ 根据 retry policy 判断

unknown
→ 先 reconcile / query status
→ 禁止盲目重放

never_executed
→ 可以继续执行
```

所以 Durable Execution 与 Day 35 的 Tool Outcome 是直接衔接的。

## Checkpoint 应该放在哪里

不要每写一行代码就 checkpoint。比较实用的是“安全边界”：

```text
LLM 返回并完成解析
↓ checkpoint（可选）

Tool 准备执行
↓ 记录 started / intent

Tool 完成并确认结果
↓ 保存 outcome + idempotencyKey
↓ checkpoint

进入下一 Agent Step
```

尤其是有副作用 Tool，最好形成：

```text
prepare
→ persist intent
→ execute
→ persist outcome
→ continue
```

这和数据库 WAL / workflow engine 的思路很接近。

## Durable Execution 不等于把函数暂停在某一行

不要期待 Node.js 重启后还能恢复：

```ts
await executeTool(...)
```

这个 JavaScript 调用栈已经没了。

真正能恢复的是**业务状态机**：

```text
RUNNING_LLM
WAITING_TOOL
TOOL_UNKNOWN
READY_FOR_NEXT_STEP
COMPLETED
```

新进程读取持久化状态，再决定下一条合法 transition。

这也是为什么之前学 Workflow / 状态机不是绕远路：到了生产恢复阶段，它会重新变得非常重要。

## 工程例子

一个最小 Checkpoint 可以先设计成：

```ts
interface AgentRunCheckpoint {
  version: 1;
  runId: string;
  step: number;
  phase:
    | "ready"
    | "waiting_tool"
    | "reconciling_tool"
    | "completed";

  messages: AgentMessage[];

  toolExecutions: ToolExecutionRecord[];

  updatedAt: string;
}
```

再抽象：

```ts
interface CheckpointStore {
  load(runId: string): Promise<AgentRunCheckpoint | undefined>;
  save(checkpoint: AgentRunCheckpoint): Promise<void>;
}
```

第一版可以做 InMemory Store 验证 contract，但真正支持 crash recovery 必须换成进程外持久化，例如数据库、Redis（取决于持久化要求）或 workflow backend。

## 三个必须记住的点

1. **恢复的是状态，不是 Promise。** 进程崩溃后调用栈消失，只能根据持久化状态重新驱动状态机。
2. **Checkpoint 必须和副作用事实一起设计。** 只有 messages，没有 Tool outcome / idempotencyKey，无法安全 replay。
3. **unknown 是恢复流程的一等状态。** 对有副作用 Tool，unknown 不能直接重试，要先 reconcile。

## 思考题

Agent 在调用 create_order 时，订单服务已经创建订单，但进程在保存本地 checkpoint 前崩溃。重启后本地最后一个 checkpoint 显示“准备执行 create_order”。

应该直接再执行一次吗？

不应该。这个场景说明本地 checkpoint 和外部副作用之间存在经典的 dual-write gap。更可靠的方案是把稳定 idempotencyKey 传给订单服务；恢复时用这个 key 查询/重试，让下游保证不会创建第二张订单。仅靠本地 checkpoint 无法彻底解决跨系统 exactly-once。

## 中午继续什么

午练会先实现 Durable Execution 的最小骨架：

```text
AgentRunCheckpoint
CheckpointStore
InMemoryCheckpointStore
RecoveryDecision
```

重点不是马上把整个 Agent Loop 改成工作流引擎，而是先让代码能明确判断：

```text
executed → skip
failed → retry policy
unknown → reconcile
never_executed → execute
```

然后再逐步把 checkpoint 接入现有 ProductionAgentRuntime。

## 代码仓库

仓库：github.com/qianduandaren-oss/AgentAIwechat

运行前已实际核对当前 main：Day 34 的 Cancellation 代码仍在；同时发现一个需要优先修的真实缺口——Agent Loop 虽然把 signal 传给了 llmInvoker，但 ProductionAgentRuntime 自定义的 llmInvoker 没有接收第三个 options 参数，createResilientLLMInvoker / reliability fallback 也仍是旧的双参数契约。因此当前“LLM in-flight cancellation 已完整贯穿 resilience / fallback”还不能算闭环。

另外 Day 35 的 ToolEffectPolicy / ToolExecutionRecord 代码仍未落到 main，package.json 仍是 agent-ai-day1-34。

本次 08:00 先按“发现缺口优先修复”的规则处理仓库同步；计划更新：
- src/runtime/llm-invoker.ts
- src/runtime/reliability-fallback.ts
- src/runtime/production-runtime.ts
- docs/day36-durable-execution-crash-recovery.md

同步状态将在写入完成后确认。

## 文章归档

文章仓库：github.com/qianduandaren-oss/AIAgentAutoArticle

目标路径：articles/2026-09/day-36/morning.md

Day 35 morning/noon/evening 仍是历史待补项；只能在取得当时完整原文时补归档，不会用摘要伪造。