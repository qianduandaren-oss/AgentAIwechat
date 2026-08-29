# Agent AI 工程师 · Day 8：把 Planner 真正接到 LLM

Day 7 已经完成了最小 Planner Loop：

```text
Goal → Planner → Action → Reflection / Policy
     → Executor → Observation → State Update → Planner
```

Day 8 不再让 `CustomerPlanner` 把下一步写死，而是把 Planner 接回前面已经实现的 `callLLM()` 和 Structured Output。

完整链路变成：

```text
Goal + PlannerState
        ↓
     LLMPlanner
        ↓
     callLLM()
        ↓
Structured Output
        ↓
parsePlannerAction()
        ↓
Plan Validation
   ├─ invalid → 带反馈重新请求模型
   └─ valid
        ↓
Reflection / Policy
        ↓
Executor
        ↓
Observation
        ↓
Reflection Note
        └────────→ 下一轮 LLMPlanner
```

## 08:00 早课：先定义 Planner 的输出契约

核心文件：

```text
src/llm/types.ts
src/planning/schema.ts
```

本次给 `LLMTask` 增加：

```text
planner_next_action
```

同时给 `LLMRequest` 增加可选 `responseSchema`。Planner 当前只允许四类结构化 Action：

```text
search_customer
search_chat_history
search_knowledge
finish
```

关键点：Schema 是模型输出契约，不等于安全边界。模型返回的 JSON 仍然属于外部输入，必须再次由程序校验。

## 12:00 午练：实现 LLMPlanner

核心文件：

```text
src/planning/llm-planner.ts
src/planning/validation.ts
src/llm/providers/mock-provider.ts
```

`LLMPlanner.planNext()` 每轮会读取：

```text
goal
observations
reflectionNotes
validationFeedback
allowed action space
```

然后执行：

```text
callLLM()
  ↓
extractStructured()
  ↓
parsePlannerAction()
```

`parsePlannerAction()` 不相信 TypeScript 的泛型断言，而是运行时逐字段检查 `type` 和 `input`，最后再经过 `assertActionAllowed()`。

如果模型第一次返回：

```json
{
  "type": "send_message",
  "input": {
    "customerId": "C001"
  }
}
```

校验层会拒绝它。这个 Action 不会进入 Executor，`LLMPlanner` 会把失败原因作为 validation feedback 再请求一次模型。

## 18:00 晚练：Re-planning 与 Observation Reflection

核心文件：

```text
src/planning/reflection.ts
src/planning/run-planner.ts
src/demos/day8-llm-planner-demo.ts
```

Day 7 的 Reflection 主要检查重复 Action。Day 8 继续增加 Observation 检查：

```text
null / undefined
空字符串
空对象
```

这些结果不会被当成“工具已经成功提供证据”，而是形成 Reflection Note，供下一轮 Planner 重新决策。

`runPlanner()` 也增加了可配置的 `maxSteps`，默认仍然使用 6 步保护，防止模型持续重规划造成无限循环。

## 默认 Demo 为什么仍然用 MockLLMProvider

课程代码已经走完整的真实调用接口：

```text
LLMPlanner → callLLM() → LLMProvider.generate()
```

仓库默认使用 `MockLLMProvider`，是为了不用 API Key 也能稳定运行和观察 Planner Loop。以后接 OpenAI、Anthropic 或其他 Provider 时，只需要实现同一个 `LLMProvider` 接口，并让 Provider 按 `responseSchema` 返回结构化结果，Planning 层不用重写。

## 运行

```bash
npm install
npm run build
npm run demo:day8
```

正常路径应看到：

```text
search_customer
→ search_chat_history
→ search_knowledge
→ finish
```

第二段 Validation Demo 会故意让 Provider 第一次生成一个不允许的 `send_message`。最终应看到类似：

```text
Planner model calls: 5
Executor received: search_customer -> search_chat_history -> search_knowledge
Invalid send_message reached executor: false
```

这说明非法模型决策被挡在 Executor 之前，并通过重新规划恢复。

## Day 8 结束后的能力

现在 Planning 层已经从 Day 7 的“程序写死下一步”升级为：

```text
LLM 负责提出下一步
Structured Output 负责约束形状
Validation / Policy 负责判断能不能执行
Reflection 负责发现循环和无效 Observation
Executor 只执行通过校验的 Action
State 把结果继续反馈给下一轮 Planner
```

下一步可以继续进入更复杂的 Plan Validation、基于失败原因的 Re-planning，以及把 LLM Planner 接进 `ProductionAgent` 的开放式分析路径。
