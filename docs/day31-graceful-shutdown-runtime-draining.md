# Day 31 早课：Graceful Shutdown / Runtime Draining

日期：2026-09-21

## 核心问题

服务收到 SIGTERM 或准备滚动发布时，不能直接 process.exit()。Production Agent Runtime 需要显式生命周期：RUNNING → DRAINING → STOPPED。

## 当前仓库边界

Day 30 已支持有界 Admission、Queue Timeout、queued AbortSignal cancellation；但 ProductionAgentRuntime 还没有 lifecycle/drain API，RunAdmissionController 也没有 close/drain 语义。

## 目标关闭链

```text
SIGTERM / deploy
↓
Runtime enters DRAINING
↓
reject new Runs
↓
cancel/reject queued Runs
↓
wait active Runs
↓
active = 0 → STOPPED
```

第一版不要假装能强制停止正在运行的 LLM/Tool。Running Cancellation 尚未端到端实现，因此 drain deadline 与 forced cancellation 要分阶段完成。

## 下一步实现

午练新增 Runtime lifecycle 状态和 Admission close/drain 能力，并用测试验证：draining 后新 Run 被拒绝、queued Runs 被清理、active Runs 完成后 drain resolve。
