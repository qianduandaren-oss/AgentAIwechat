# Day 66 午练：Recovery 入口到真实 SQLite 的故障注入

日期：2026-10-26（Asia/Shanghai）

## 验证目标

上一段早课只验证了 `RecoveryEntryDispatcher` 的无副作用路由边界；本次新增 **组合层 → Atomic Adapter → SQLite Admission → Prepare → Finalizer** 的真实数据库回归。不创建正式 HTTP 路由，也不打开生产 Feature Flag。

运行：

```bash
npm ci
npm run test:recovery-entry-sqlite-fault
npm run test:atomic-control-only
npm run test:recovery-inflight-evidence
npm run test:durable-recovery-operation
```

测试源码：`src/demos/day66-recovery-entry-sqlite-fault-test.ts`。

## 故障矩阵

| 场景 | 持久化预期 | 不允许的副作用 |
| --- | --- | --- |
| Flag OFF | atomic SQLite 无新 Command | 不能调用 Atomic Handler |
| Flag ON，首次 quarantine | Checkpoint v1，Control v1，terminal Command v3，Outbox 1 条 | 不能调用旧 terminal writer |
| Finalizer COMMIT 后丢响应 | 仍为 terminal v3 + Snapshot，重试 replay | 不重新授权/Prepare、不新增 Outbox、不 fallback |
| 同 commandId 修改 reason | 身份冲突 | 不借用或覆盖历史结果 |
| Admission 后授权异常 | Command 保持 executing v2，无 Control/Outbox | 不盲目重新执行或调用旧 Handler |
| Flag ON + resume | Admission 前明确拒绝 | 新旧 Handler 均不得运行 |
| 终态缺失 ResultSnapshot | 抛出明确错误 | 不推测历史结果、不重执行 |

入口边界必须在**任何数据库副作用之前**捕获 Feature Flag。对于已进入 `executing` 的命令，重试应先调查持久化事实，不自动重新认领；**COMMIT 后未收到回复并不等于事务失败**。

## 证据与发布边界

本回归使用真实 SQLite 和一个用于侦测误调用的旧路由 Spy。它仍是进程内组合层的故障注入，**不包含生产 HTTP/CLI 接线**，也没有验证多进程入口部署、运维 RBAC、跨租户身份隔离、超时/超载策略、审计暴露与外部 Tool 副作用恢复。已有的旧 Service 与 Orchestrator 保留原写入方式：不能依赖异常后回退到旧路由。

只有在同 SHA 的 CI Build + 旧回归 + 新故障场景全部通过后，才能标记这一层的验证通过。最终生产级单一 terminal writer 和 Cutover 仍为 **NO_GO**。
