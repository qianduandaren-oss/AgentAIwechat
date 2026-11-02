# Day 73 早课：Receipt Consumption CAS 合同（2026-11-02）

Day 72 已实现可信远程收据的持久化与只读终态候选检查。
Day 73 早课先固定 **消费收据的事务协议**，不提前修改正式 Finalizer。

## 必须在同一个 SQLite BEGIN IMMEDIATE 内验证并写入

1. 从持久化 Ledger 读取完整不可变 Intent，确认 UNKNOWN 和当前 epoch；
2. 从远程收据表读取已保存的 receipt，校验 providerId/receiptId/effectId/idempotencyKey/epoch，拒绝与模拟 Sink 混用；
3. 校验 executing v2 Command、owner=same_sqlite atomic_control_only、当前 Run/ACL/Grant 与版本；
4. 校验 Control 当前版本与 expectedControlVersion 一致；
5. 重新验证 Provider conformance（注意 Registry 不在 SQLite，仍有跨系统一致性缺口）；
6. 以 UNIQUE(effect_id) + UNIQUE(provider_id,receipt_id) 消费凭证（未来新表），并同事务写 Control CAS、Command terminal CAS、Outbox；
7. 任一检查失败，ROLLBACK；重复请求只允许在核对完整已提交事实后返回历史结果，不可再次产生 Outbox。

```text
UNKNOWN + immutable remote receipt + executing v2
       ↓  read-only review / pure consumption plan
BEGIN IMMEDIATE (future, not implemented yet)
       ├─ live ACL / owner / epoch / receipt
       ├─ Control CAS + Command CAS
       ├─ receipt consumption UNIQUE
       └─ Outbox exactly once in local DB
COMMIT → only then may return terminal
```

## 本次实际交付

- `src/runtime/recovery-remote-receipt-consumption.ts`：纯函数 `planRemoteReceiptConsumption()`，只返回待进入原子事务的绑定字段和预期版本；
- `src/demos/day73-morning-receipt-consumption-test.ts`：纯合同回归；
- `npm run test:recovery-receipt-consumption-contract`。

**不包含**远程收据消费写入、真实 Provider/IAM、跨系统原子性、正式 HTTP/CLI 或 Legacy 旁路隔离。生产发布仍为 **NO_GO**。午练将尝试把上述约束下沉到同库候选 Finalizer，晚练做故障注入与回归。
