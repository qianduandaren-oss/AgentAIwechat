# Day 31 Noon — Runtime Lifecycle / Draining

新增 `RuntimeLifecycle`，建立 `RUNNING → DRAINING → STOPPED` 状态机，并用 `runtime-lifecycle-test.ts` 验证：draining 后拒绝新 run，已有 active run 自然完成后进入 STOPPED。

## 当前边界

本次尝试直接扩展 `RunAdmissionController` 的 close/drain 语义时，GitHub 写入被安全检查阻止，因此目前 lifecycle 核心与测试已落库，但还没有完成 `ProductionAgentRuntime` 和 Admission Queue 的最终整合。

下一次必须优先补齐：

1. draining 时取消/拒绝 queued waiters；
2. `ProductionAgentRuntime.run()` 接入 lifecycle；
3. `ProductionAgentRuntime.drain()` 等待 active runs 归零；
4. integration test 覆盖 active + queued + new run 三类行为。

不能把当前状态描述为完整 Graceful Shutdown。
