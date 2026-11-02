# Day 73 午练：Receipt Consumption CAS（SQLite 候选实现）

日期：2026-11-02。承接 Day 72 的不可变远程收据与 Day 73 早课纯消费计划。

## 本次落地

`src/runtime/recovery-remote-receipt-finalizer.ts` 在同一个 SQLite `BEGIN IMMEDIATE` 事务内完成：

1. 重读原始 Effect Intent、UNKNOWN/Epoch、不可变远程收据；禁止模拟 Sink 与远程证据混用。
2. 重新验证 same_sqlite ACL/Grant/Run 修订、Command executing v2 与 atomic_control_only Owner。
3. 重新审计 Provider Conformance 的当前配置修订与收据绑定（**外部 Registry 不是 SQLite 原子权威**）。
4. 检查 Checkpoint compare-only 版本与 Control CAS 版本，调用既有 `prepareControlOnlyRecovery()`。
5. 插入唯一收据消费记录、Control CAS、Command terminal v3、Outbox event、Effect committed；任一冲突整体 ROLLBACK。
6. 再次请求时核对不可变绑定、持久化终态、Control 与 Outbox，只有一致才返回 `replayed_terminal`，不会重复写入事件。

## 运行

```bash
npm ci
npm run test:recovery-receipt-consumption-sqlite
npm run test:recovery-remote-receipt-persistence
npm run test:recovery-authorization-finalize-fence
```

测试覆盖两个连接的稳定重放、撤权、Checkpoint/Control 漂移、Provider 版本变化、收据错绑、Outbox 冲突、写入中途故障回滚和重启恢复。故障注入只用于测试，不允许生产调用方控制。

## Release Gate

本次仅是 **同库候选 Finalizer**，不是正式 Recovery 路由。Provider Registry 不在 SQLite 事务内，真实 Provider 认证、生产 IAM/ACL、正式 HTTP/CLI、Legacy 旁路隔离和跨进程故障注入仍未完成；也不证明第三方 exactly-once。生产裁决：**NO_GO**。
