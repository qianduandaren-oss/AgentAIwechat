# Day 73 晚练：收据消费终态的双写者隔离与重放证据完整性

日期：2026-11-02。承接 Day 73 早课的纯 CAS 计划、午练的 SQLite 收据消费 Finalizer。

## 这次先修复了什么

Day 73 午练首次 CI Run 41385849771 在 Build 阶段失败，原因是 `recovery-remote-receipt-finalizer.ts` 的 `deny` 箭头函数没有被 TypeScript 可靠地用作控制流收窄点，导致可选数据库行和 `RecoveryRemoteReceiptConsumptionPlan` 判别联合仍被认为可能为空或为 hold。改成显式的 `function deny(...): never`，修复了该类编译断裂；后续 CI Run 41424942760 完成且成功。

## 双写者边界

- 旧的 `SQLiteRecoveryFinalizationUnitOfWork.commit()` 是通用 Command/Control/Outbox Finalizer；新的 `SQLiteRecoveryRemoteReceiptFinalizer.finalize()` 负责有 Effect Intent 的远程收据消费。
- 如果两个入口都能对同一个 effect-backed Command 提交 terminal，收据消费与 Outbox 就会失去单一写入者。
- 因此通用 Finalizer 在自己的 `BEGIN IMMEDIATE` 内先查同库 `recovery_effect_intents`，只要存在绑定当前 commandId 的 Intent 就拒绝，返回 `effect_requires_receipt_consumption`。这阻止了**此通用 Finalizer 入口**绕过收据消费；不代表所有 Legacy、CLI 或未接入入口都已经隔离。
- 新 Finalizer 的成功重放不仅核对 Consumption、Command、Control 和 Outbox 行是否存在，还验证 Outbox 的 `id`、`eventId`、`commandId`、`runId`、`kind` 以及事件正文中的 operation、applied、providerId、receiptId。篡改收据、消费记录或事件关联必须 fail closed。

## 晚练回归

新增 `src/demos/day73-evening-receipt-finalizer-boundary-test.ts`，基于午练同一套 SQLite 授权、Effect、Provider 和收据夹具，覆盖：

1. 旧通用 Finalizer 试图绕过收据消费，被 effect-backed guard 拒绝，状态不变。
2. 成功终态之后篡改 Outbox 里的 receiptId，拒绝稳定重放，不增加事件。
3. 篡改 Consumption 绑定的 receiptId，拒绝重放。
4. 篡改 Outbox eventId，拒绝重放。

运行：

```bash
npm ci
npm run test:recovery-receipt-consumption-sqlite
npm run test:recovery-receipt-finalizer-boundary
npm run test:recovery-authorization-finalize-fence
```

## 生产限制

这些是同文件 SQLite 候选路径。真实 Provider 认证、Registry 与数据库的一致性协议、完整入口隔离、正式 IAM/ACL、Outbox 下游幂等、跨进程故障注入和生产 Cutover 尚未验收。**NO_GO**。不宣称外部 exactly-once。
