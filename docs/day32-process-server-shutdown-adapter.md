# Agent AI 工程师 · Day 32 早课

## Process / Server Shutdown Adapter：SIGTERM 只是触发器，不要把关闭逻辑塞进进程事件

日期：2026-09-22

Day 31 已完成 Runtime Lifecycle 与 Admission drain 的整合。Day 32 继续 Deployment Boundary：把 Runtime 的 `drain()` 接到真实服务宿主。核心原则是进程信号只负责触发，真正的关闭语义仍由 Runtime 管理。

## 核心链路

```text
SIGTERM / SIGINT
↓
HTTP Server stop accepting new connections
↓
ProductionAgentRuntime.drain()
↓
Admission close / queued Runs rejected
↓
active Runs finish
↓
Runtime STOPPED
↓
close remaining infrastructure
↓
process exits naturally
```

## 设计边界

- Signal Handler：薄适配层，只负责启动一次 shutdown sequence。
- HTTP Server：停止接收新的网络请求，但不定义 Agent 的 drain 语义。
- ProductionAgentRuntime：负责 RUNNING → DRAINING → STOPPED。
- Admission：拒绝新准入并清理 queued Runs。
- Process：最后退出，不直接承担业务清理。

## 幂等性

SIGTERM/SIGINT 可能重复触发，因此 shutdown adapter 必须防止重复执行。常见方式是保存同一个 shutdown Promise，后续信号复用它，而不是重复调用 server.close/runtime.drain。

## 当前边界

当前 Runtime 已有 `beginDrain()` / `drain()`，但 Running Cancellation 尚未端到端传播到 Agent Loop、LLM 与 Tool。因此第一版 shutdown 允许 active Runs 自然完成，不把 drain deadline 冒充成安全强制取消。
