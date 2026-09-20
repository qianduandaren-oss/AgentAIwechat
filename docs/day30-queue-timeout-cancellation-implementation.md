# Day 30 午练：Queue Timeout / Cancellation 实现

本次在现有 RunAdmissionController 上增加排队生命周期，不新建孤立调度器。

- `acquire({ timeoutMs, signal })` 支持等待超时与 AbortSignal。
- 新增稳定错误码 `RUN_QUEUE_TIMEOUT`、`RUN_CANCELLED`。
- waiter 使用 pending/admitted/timed_out/cancelled 状态，确保 timeout、abort、release 竞争时只有一个结果生效。
- timeout/cancel 后从 FIFO queue 真正移除 waiter，并清理 timer / abort listener，避免 ghost waiter。
- `ProductionRunOptions` 新增 `queueTimeoutMs` 和 `signal`，由 Runtime 传入 Admission Controller。
- 当前 cancellation 只覆盖“等待执行槽位”阶段；已经 admitted 后的 Agent Loop / LLM / Tool 取消传播尚未实现，留到后续课程。

验证入口：`npm run test:run-admission`，脚本会先 TypeScript build，再运行 timeout/cancellation 测试。