# Day 21 早课：Runtime Orchestration

Day 21 开始把前面已经存在的 Provider、Resilience、Budget、Tracing、Security 和 Tool Runtime 从“模块集合”收口成一条可解释的 Production Agent Runtime 主链。

当前主链由 `ProductionAgentRuntime` 负责装配：RuntimeConfig -> Resilient LLM Invoker -> AgentRunBudget -> Agent Loop -> Trace / Secure Tool Executor / Audit。

## 核心原则

1. Agent Loop 负责认知循环，不负责实例化所有基础设施。
2. Production Runtime 是 Composition Root，集中装配配置、策略、Provider、预算、安全与可观测性。
3. 模块存在不等于生产能力生效；必须确认它是否真正进入主执行路径。

## 当前待收口点

`budget-policy.ts` 已能计算 healthy / warning / exhausted，但当前 Production Runtime 只接入硬预算 `AgentRunBudget`，Budget-aware Degradation 尚未真正改变 Planner / RAG / Reflection 的执行分支。Day 21 后续练习将优先处理这一类“模块已存在、主链未生效”的缺口。
