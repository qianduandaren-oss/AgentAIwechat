# Day 32 Noon — Shutdown Coordinator

Day 31 已完成 Runtime Lifecycle + Admission drain。Day 32 把宿主关闭流程抽成独立 `ShutdownCoordinator`：先关闭网络入口，再等待 Runtime drain。

```text
SIGTERM/SIGINT adapter
        ↓
ShutdownCoordinator.shutdown()
        ↓
server.close()
        ↓
runtime.drain()
        ↓
stopped
```

## 设计边界

- Coordinator 不直接监听 process signal，便于测试和复用。
- `shutdown()` 幂等：第一次创建并缓存 Promise，后续调用返回同一 Promise。
- ServerHost 只要求 `close(): Promise<void>`，可以适配 Node HTTP、Fastify、Express 等宿主。
- DrainableRuntime 只要求 `drain(): Promise<void>`，当前 `ProductionAgentRuntime` 已满足该契约。
- 当前不做强制 running cancellation；drain 仍等待 active Agent Run 自然完成。

## 验证

`src/demos/shutdown-coordinator-test.ts` 检查关闭顺序、状态变化以及并发/重复 shutdown 的幂等性。运行：

```bash
npm run test:shutdown
```
