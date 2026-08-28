# Agent AI 工程师 · Day 7：Planning 与 Reflection

Day 7 把 LLM、Tool Calling、Memory、RAG、MCP 和 Workflow 继续推进成一个最小 Agent Runtime。

## 完整执行链

```text
Goal
 ↓
Planner
 ↓
Action
 ↓
Reflection / Policy
 ↓
Executor
 ↓
Observation
 ↓
State Update
 └────→ Planner
```

Planning 负责探索性决策，Workflow 负责确定性执行，程序 Guardrail 负责权限和风险边界。

## 核心文件

```text
src/planning/
├── types.ts
├── policy.ts
├── planner.ts
├── executor.ts
├── action-key.ts
├── reflection.ts
└── run-planner.ts

src/demos/
└── planning-demo.ts
```

## Action Space

当前 Mini Planner 只允许：

```text
search_customer
search_chat_history
search_knowledge
finish
```

`create_reminder`、`send_message`、`update_customer`、支付和删除等真实副作用不直接开放给 Planner，应进入 Workflow，并接受权限、审批、重试和幂等控制。

## Planner State

`PlannerState` 保存当前一次执行的目标、Observation、步数、已执行 Action 指纹和 Reflection 记录。它不同于跨任务保存长期信息的 Memory。

## Duplicate Guard

`createActionKey()` 为 Tool Action 创建稳定指纹。执行前，`reflectAction()` 检查相同指纹是否已经出现；重复 Action 会被拒绝，不会再次进入 Executor。

被拒绝的原因会写入 `reflectionNotes`，供下一轮 Planner 调整决策。只做 `continue` 而不反馈拒绝原因，会让固定 Planner 不断产生相同 Action，直到耗尽最大步数。

## 运行验收

```bash
npm install
npm run build
npm run demo:day7
```

正常场景应依次执行：

```text
search_customer
search_chat_history
search_knowledge
finish
```

重复场景应看到：

```text
Reflection: Duplicate action detected
Tool executions: 1
```

这证明第二次相同查询没有真正执行。

## 下一步

Day 8 将把当前写死的 `CustomerPlanner.planNext()` 替换成 `callLLM() + Structured Output`，同时保留今天的 Action 校验、Reflection 和最大步数保护。
