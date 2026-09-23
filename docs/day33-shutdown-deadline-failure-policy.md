# Day 33 Morning — Shutdown Deadline / Failure Policy

日期：2026-09-23

Day 32 已完成 ShutdownCoordinator 与 ProcessSignalAdapter。Day 33 继续部署边界，区分 graceful drain deadline、shutdown failure、forced termination 与 running cancellation。

## 核心边界

- Graceful deadline：宿主最多愿意等待正常关闭多久。
- Shutdown failure：server.close() / runtime.drain() 主动失败。
- Deadline exceeded：关闭流程仍在运行，但宿主等待预算耗尽。
- Forced termination：宿主最终决定退出进程，是部署策略，不等于安全取消 Agent。
- Running cancellation：AbortSignal 真正传播到 Agent Loop / LLM / Tool；当前仍未完成。

## 推荐结构

```text
SIGTERM
→ ShutdownCoordinator.shutdown()
→ race(shutdown, deadline)
   ├─ shutdown completed → graceful success
   ├─ shutdown rejected → shutdown failure
   └─ deadline exceeded → escalation policy
```

Deadline 应位于宿主策略层，不应污染 Runtime 的正常 drain 语义。下一步实现 ShutdownDeadlinePolicy / runner，并保持 coordinator 本身只负责正常关闭编排。
