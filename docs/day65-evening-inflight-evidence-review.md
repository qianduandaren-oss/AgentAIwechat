# Day 65 晚练｜In-flight Evidence 与 Single Terminal Writer 复盘

日期：2026-10-25（Asia/Shanghai）

## 背景

Day 65 早课把“选路”变成纯决策；午练完成 SQLite 同库 Admission (accepted v1 → executing v2)、Control-only 纯 Prepare 和 Selective Finalizer（terminal v3 + 状态 + Outbox）。尚未把新路径切到生产入口。

**最重要的边界：命令是 executing，不等于可以安全重试。**

## 本次工程增量

- `SQLiteRecoveryFinalizationUnitOfWork.inspectInFlightEvidence(commandId, runId)` 在同一个 SQLite 只读事务里读取持久化 Command / Checkpoint / Control / Outbox event ID。不得修改状态、不得自动恢复、不得据此推断外部工具副作用。
- 对已经持久化的 Command 校验 `runId`，禁止借用另一 Run 的证据。
- `src/demos/day65-evening-inflight-evidence-test.ts` 增加 6 项边界测试：读检查不写入、授权抛错后 in-flight 暂停、Checkpoint 并发更新触发事务内 CAS、COMMIT 后丢失回复的持久化重放、跨 Run 身份拒绝、终态缺失 Snapshot 拒绝合成结果。
- `npm run test:recovery-inflight-evidence` 与 Runtime Tests CI 步骤。

## 真实事故状态矩阵

| 故障位置 | 数据库事实 | 处理动作 |
| --- | --- | --- |
| 选路后、Admission 前 | Command 不存在 | 只有明确进入新路由时才 Admission |
| Admission COMMIT 后，授权抛错 | Command=executing v2；Control、Outbox 尚无变化 | 保持 in-flight，诊断，不自动旧路由兜底 |
| Prepare 已计算，Finalize 前 Checkpoint 变化 | Checkpoint v2；Command 仍 executing v2；无本次 Control/Outbox | Finalizer CAS 冲突，回滚，调查 |
| Finalizer COMMIT 后 HTTP 回包丢失 | Command terminal v3，ResultSnapshot/Outbox/Control 已持久化 | 校验请求身份，直接 replay，不二次 Prepare |
| 已终态但 ResultSnapshot 丢失 | 状态 terminal，结果不完整 | 报错并调查，禁止重新执行 |
| 命令 ID 对应其他 runId | 身份不匹配 | 拒绝跨 Run 证据读取 |

## 操作验证

```bash
npm ci
npm run test:recovery-inflight-evidence
npm run test:atomic-control-only
npm run test:selective-recovery-unit-of-work
npm run test:durable-recovery-operation
```

CI 成功要与实际 commit SHA 对齐，不能借用 Day 65 午练前的绿色结果。
Node.js `StatementSync` 的当前项目类型声明只有 `get/run`；因此 Outbox event 列表通过单行 `json_group_array` 读取，避免调用类型中不存在的 `all()`。首次提交的 `all()` 写法导致 TypeScript 构建失败，已在后续提交中修正，不能省略这段失败证据。

## 发布门禁

- 当前增量是 **可观察证据读取 + 正式路由前的回归**，不是“恢复执行器”。
- 必须证明入口先按 Feature Flag 选择路由，绝不把新路径失败当作调用旧 Service 的条件。
- 必须证明旧 Orchestrator 不参与新路由的 terminal 写入；旧路由仍保留自身写法供旧路径使用。
- 执行中的命令不能由定时任务直接重认领；还要设计外部工具的幂等、超时/租约、operator reconciliation 和 crash windows。
- 必须有同一提交 Build、旧/新恢复回归、正式入口故障注入证据才可申请 Cutover。

**发布结论：NO_GO。**

Day 66 先围绕正式入口审查、单 writer 所有权、崩溃后人工/自动恢复边界和 Feature Flag 实施，不能跳过真正调用链的 E2E 验证。
