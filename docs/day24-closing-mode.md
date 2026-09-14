# Day 24 Morning — Agent Closing Mode

日期：2026-09-14

## 背景

当前 Agent Loop 在 Budget Policy 进入 warning 且 `allowExtraRetrieval=false` 时直接抛错：

```text
warning
→ stop expanding tool calls
→ throw Error
```

这会丢掉已经获得的 Observation。Day 24 的目标是引入显式运行模式：

```text
normal → closing → finished
```

## Closing Mode 的职责

进入 closing 后：

- 不再执行新的 Tool Call；
- 不再追加 RAG / Reflection；
- 保留已有 messages / Observation；
- 最多允许一次 final LLM call；
- final LLM call 不开放 tools；
- 如果硬预算已经 exhausted，则不能继续调用模型。

## 与 Budget State 的区别

`healthy / warning / exhausted` 是预算状态；`normal / closing / finished` 是 Agent Loop 的执行模式。Budget Policy 可以触发模式切换，但二者不应混成同一个枚举。

## 目标主链

```text
normal
  ↓
LLM → Tool → Observation
  ↓
Budget warning
  ↓
closing
  ↓
Final LLM (tools = [])
  ↓
finished
```

## 实现边界

早课只固定设计，不修改 Agent Loop 行为。午练再把 closing mode 接入 `runAgentLoop()`，并补可执行检查，避免把设计文档误当成已经上线的功能。
