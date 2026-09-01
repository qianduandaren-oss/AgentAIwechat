# Day 11：Agent Evaluation 基础

Day 10 已经完成多候选 Agent Routing。Day 11 开始把“看起来能跑”升级为“可以重复验证”。

第一阶段先评 Routing：给定固定 Goal 和 Expected Agent，运行 Router 得到 Actual Agent，并计算 pass/fail 与 accuracy。

评测层必须与运行层分开：`src/multi-agent` 负责生产行为，`src/evaluation` 负责定义测试样本、期望结果和评分。后续会逐步扩展到 Planner、Tool Use、Trajectory 和最终答案质量。

当前新增：

- `src/evaluation/types.ts`
- `src/evaluation/routing-cases.ts`

下一步实现 `routing-evaluator.ts` 与可重复运行的 Eval Runner。
