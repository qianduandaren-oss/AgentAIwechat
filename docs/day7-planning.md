# Agent AI 工程师 · Day 7：Planning

Day 7 开始把前面的 LLM、Tool Calling、Memory、RAG、MCP、Workflow 往真正的 Agent Runtime 继续推进。

## 核心问题

Planning 解决的不是“让模型随便做决定”，而是：

```text
Goal
  ↓
读取当前 State
  ↓
在受控 Action Space 中选择下一步 Action
  ↓
Executor 执行
  ↓
Observation
  ↓
更新 State
  ↓
再次 Planning
```

和 Workflow 的区别：

```text
Workflow：程序提前决定路径
Planning：Agent 在程序允许的范围内决定下一步路径
```

实际生产系统通常采用混合架构：

```text
开放式分析 / 信息探索
        ↓
     Planning
        ↓
   得出下一步建议
        ↓
确定性、高风险、有副作用的操作
        ↓
     Workflow
```

## Day 7 新增目录

```text
src/planning/
├── types.ts
├── policy.ts
├── planner.ts
└── executor.ts
```

### `types.ts`

定义 Planning 的核心数据结构：

```text
PlanningAction
PlanStep
Plan
Observation
AgentState
PlanningDecision
PlanningRunResult
```

`AgentState` 记录目标、已完成步骤、Observation、错误和当前迭代次数。Planner 不应该每轮从零开始猜，而应该始终基于 State 决策。

### `policy.ts`

负责限制 Action Space。

当前允许 Planner 使用的动作：

```text
search_customer
search_chat_history
search_order
search_knowledge
create_followup_plan
finish
```

真实副作用不进入 Planner 的直接执行范围，例如：

```text
create_reminder
send_message
update_customer
delete_customer
charge_payment
refund_order
```

原则：

```text
LLM 决定做什么
程序决定允许做什么
```

### `planner.ts`

`Planner` 负责：

```text
创建 AgentState
→ 请求下一步 PlanningDecision
→ 校验 Decision
→ 执行 Action
→ 写入 Observation
→ 更新 State
→ 再规划
```

同时通过 `maxSteps` 防止 Planning 无限循环。

Planner 不绑定某一家模型。它只依赖：

```ts
export type PlanningDecisionProvider = (
  state: Readonly<AgentState>
) => Promise<PlanningDecision>;
```

后续可以把这个 Provider 接到现有 `callLLM()`，也可以先用 Mock Provider 做课程调试。

### `executor.ts`

Planner 只产生决策，真正的 Tool 执行交给 `PlanningExecutor`。

```text
Planner
  ↓ PlanningDecision
Policy
  ↓ 校验
PlanningExecutor
  ↓
Tool Handler
  ↓
Observation
```

这样 Planner 不会直接拥有数据库、HTTP、支付、删除数据等无限权限。

## 示例：客户跟进分析

用户目标：

```text
张三最近一直没有报名，帮我分析一下应该怎么继续跟进。
```

一种可能路径：

```text
search_customer
      ↓
Observation: customer_001 / high intent / PLC
      ↓
search_chat_history
      ↓
Observation: 连续询问周末是否能学习
      ↓
search_knowledge("PLC 周末班 上课时间")
      ↓
Observation: 支持周末学习
      ↓
create_followup_plan
      ↓
finish
```

如果聊天记录已经说明客户退款过，Planner 也可以根据新的 Observation 改走另一条路径，而不是继续机械执行最初计划。

## Planning 和 Workflow 的边界

对于下面的需求：

```text
帮我找到最近最值得跟进的 5 个客户，
分析每个人没成交的原因，
给出跟进策略，
然后自动创建明天下午的跟进任务。
```

推荐拆分：

```text
Planner
├── 找候选客户
├── 查询聊天 / 订单 / 知识库
├── 判断未成交原因
└── 生成跟进策略

Workflow
├── 校验客户 ID
├── 校验执行时间
├── 权限检查
├── 幂等检查
├── 必要时人工审批
└── 创建真实跟进任务
```

也就是说：

```text
Planning 负责探索和判断
Workflow 负责确定性执行和真实副作用
```

## 下一步

Day 7 午练会在这套结构上继续实现 Mini Planner，把 `PlanningDecisionProvider` 接到模型，让 Agent 真正根据每一轮 Observation 决定下一步 Tool，而不是把路径提前写死。
