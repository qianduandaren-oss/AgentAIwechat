# Day 63 晚练｜Compatibility Landing 与恢复路由发布门禁

日期：2026-10-23（Asia/Shanghai）。此文记录候选代码合入状态，不代表原子 Recovery 已可切流量。

## 今天实际合入 main 的最小兼容修改

- `src/runtime/recovery-operations.ts`：RecoveryControlState 增加可选 `causedByCommandId?: string`；不为历史记录补造来源。
- `src/runtime/sqlite-recovery-finalization.ts`：原样导出 `RECOVERY_FINALIZATION_SCHEMA`，并更新构造器引用；SQL DDL 原文、表、UNIQUE 约束不变。
- `scripts/day63-contract-landing.mjs`：修正 Outbox UNIQUE 正则中意外的双重转义（`\\s` 应为正则空白匹配 `\s`）。
- `scripts/tests/day63-contract-landing.test.mjs`：新增与当前 main 源码绑定的契约回归，专门防止半套改动及 UNIQUE 被删除。

## 在完整主仓库验证（需要真实 checkout）

```bash
node scripts/day63-contract-landing.mjs .
node --test scripts/tests/day63-contract-landing.test.mjs
npm run build
npm run test:recovery-operations
npm run test:recovery-unit-of-work
npm run test:durable-recovery-operation
```

注意：仅有 `PATCHED_STRUCTURE` 不代表上面主仓库所有命令通过，也不代表正式 Atomic Recovery 可以放行。上述测试运行情况必须以实际 CI / 完整仓库执行记录为准。

## 剩余 NO_GO 阻塞项

1. Day 62 的 `RecoveryWriteSet`、Selective Finalizer、命令身份与 Outbox 归属校验仍未合入 main；当前 Finalizer 仍无条件推进 Checkpoint version。
2. 旧 `RecoveryOperationService.execute()` 仍可能在 Finalizer 事务外先保存 Control 或调用 Coordinator 修改 Checkpoint。
3. 旧 Orchestrator 仍在 executor 后写 terminal；正式新路由需要唯一持久化 terminal writer。
4. 正式入口缺少故障注入、COMMIT 丢响应后的 ResultSnapshot 重放、主仓库全部旧回归及同库绑定证据。

**发布结论：NO_GO。** 不允许因为只读结构检查通过或局部夹具 34/34 通过就开启 Feature Flag。下一步先运行完整 main 的回归，再拆分新路由 Prepare 与 Finalizer 的持久化所有权。
