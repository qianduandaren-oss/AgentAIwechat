# Day 66 早课｜Recovery 入口所有权与 Feature Flag 边界

日期：2026-10-26（Asia/Shanghai）

## 当前真实源码结论

- `src/runtime/http-adapter.ts` 目前只有 `handleAgentRun()`，没有 Recovery Command HTTP 写入口；`src/runtime/production-runtime.ts` 处理普通 Agent Run，而非 Recovery 运维命令。
- `DurableRecoveryOperationOrchestrator` 仍通过 `RecoveryOperationService.execute()` 调用旧执行路径，并在成功/失败分支写 Command terminal。
- 旧 Service 对 quarantine / release_quarantine / dead_letter 会独立调用 `controlStore.save()`，不受新 SQLite Finalizer 事务回滚保护。
- Day 65 `AtomicRecoveryControlOnlyAdapter` 具备同库 Admission / Prepare / Finalizer 和终态重放，但尚未连接正式外部入口。

## 今日新增边界

`src/runtime/recovery-entry-dispatcher.ts` 是组合层（composition seam），**不是已经上线的 HTTP 路由**。

- flag OFF：显式调用旧 Orchestrator，一次；不调用 atomic adapter。
- flag ON + Control-only：仅调用 atomic adapter；无论成功、suspend、replay 还是抛错，绝不触发 legacy fallback。
- flag ON + unsupported operation：副作用发生前明确拒绝；正式部署应按操作粒度设计放量策略。
- atomic 返回意外的 legacy/unsupported 动作：视为契约错误，不尝试另一写入者。

当前代码没有定义 HTTP 返回码、鉴权来源、配置热更新、灰度权限或真正的 external ingress；应在后续课程继续落地。入口选择必须在 Admission 和任何旧 Service 副作用之前完成。

## 关键不变量

```text
Command ingress → Capture flag once
  ├─ OFF → legacy Orchestrator → old terminal CAS
  ├─ ON & control-only → Atomic Adapter → SQLite Finalizer terminal CAS
  └─ ON & unsupported → reject before effects

Atomic failure / response loss → explicit durable inspection
                           ↛ legacy fallback
```

## 自测与下一步

```bash
npm run build
node dist/demos/day66-recovery-entry-dispatcher-test.js
npm run test:atomic-control-only
npm run test:recovery-inflight-evidence
npm run test:durable-recovery-operation
```

测试只能证明组合层的 writer 互斥，不能证明生产请求已经通过它。后续须增加正式入口 E2E、功能开关权限控制、异常码映射、in-flight 运维核对及同一 Commit 的 CI。

## Cutover 门禁

**NO_GO**：旧入口尚未通过组合层；没有正式 Recovery HTTP 路由和端到端故障注入，未证明当前运行部署里不会同时存在旧与新写入者。禁止因为这份合入而开启生产 Feature Flag。
