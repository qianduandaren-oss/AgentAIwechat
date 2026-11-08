# Day 79 早课｜Single Writer Service Boundary：不要再让旧 Worker 直接打开 SQLite

日期：2026-11-08（Asia/Shanghai）｜Week 12｜20–25 分钟。

## 承接 Day 78 的真实状态

- `SQLiteFencedOutboxDelivery` 已把 Epoch + Lease + Version CAS 放在同一 SQLite 写事务。
- Day 78 晚练**故意成功**运行 `UPDATE recovery_outbox`，证明持有数据库文件写权限的旧进程仍能绕过候选 Fencing。
- `RecoveryOutboxDispatcher` 在 `src/runtime/recovery-outbox.ts` 中仍可走旧的 `markAttempt → publish → markDispatched`。
- `SQLiteRecoveryOutboxDeliveryClaimer.acknowledge()` 仍以可伪造的 `source` 字面量接受原始 ACK；真正的 Verified Adapter 与 Epoch 候选尚未组合为强制生产入口。

## 目标架构（尚未实现）

```text
旧 Worker / CLI / 管理端                   新 Worker / 可信客户端
       |                                          |
       X  不能持有生产 SQLite 写权限               | 仅受控 RPC / IPC
                                                  v
                                        Trusted Delivery Service
                                       (鉴权、授权、审计、速率限制)
                                                  |
                           受信 bootstrap + Provider ACK verifier
                                                  |
                             单一写入 owner / current Writer Epoch
                                                  |
                                   BEGIN IMMEDIATE（同一 SQLite 文件）
                                   Epoch + Lease + Version CAS
                                                  |
                                      recovery_outbox + leases
```

“单一写入权威”不等于只有一个线程，也不等于在代码里创建一个 Singleton。它要求**拥有生产数据库写权限的主体可被操作系统/部署平台真正限制**，而且所有被允许的写操作都应用不可绕过的约束。SQLite 没有用户级表权限；同一 OS 用户或可访问同一挂载卷的旧进程仍可能直接打开 DB。

## 本次引入的 TypeScript 契约

`src/runtime/recovery-single-writer-service-contract.ts` 只声明 `claimOutbox({outboxId})` 和 `confirmOutbox({outboxId,eventId,leaseToken,rawConsumerResponse})` 端口。

刻意不把 `epoch`、`workerId`、`consumerContract` 或 `nowEpochMs` 放到外部可控参数中；这些必须由受信服务端控制的部署身份、协调器和时钟注入。

**重要：** TypeScript 的 interface 是编译期契约，不提供进程隔离、真实认证、数据库权限或运行时安全证明。今日只完成架构与类型草案，没有可用的网络服务或 RPC 实现。

## 迁移顺序与验收门槛

1. **盘点所有写入者**：`RecoveryOutboxDispatcher`、旧 `markDispatched`、raw `acknowledge`、候选 `SQLiteFencedOutboxDelivery`、脚本/CLI、持有文件权限的其他进程。
2. **先隔离旧实例**：暂停旧 Dispatcher；部署时确认旧实例退出且不能重启后再获得写权限；禁止新旧实例共同写一个 DB 文件。
3. **收敛数据库所有权**：SQLite 文件及目录仅由受信服务账户访问，其他进程不挂载可写数据库；一个相同 OS 用户的进程不能被视为已隔离。不要把 SQLite 放到不受支持的共享网络文件系统上实现跨机多写者。
4. **服务端控制所有身份**：调用方不指定当前 Epoch、owner 或消费者认证 Adapter；ACK 必须校验真实响应的签名/通道身份与 eventId/consumerId，随后同事务重查 Epoch + Lease + CAS。
5. **故障注入验收**：来自旧 OS 身份的直接写应在 OS 层失败；无权限调用被服务拒绝；双 Worker 抢占、租约过期、旧代次、ACK 重放均保持一致。
6. **灰度/回滚防倒退**：回滚旧版本也不得恢复 SQLite 文件写权限；未通过第 1–5 项时 NO_GO。

Day 76 的六项 Cutover Evidence 属于启动证据，不是数据库 ACL。Day 79 将通过运行时入口与部署层检查来验证这些声明，而不是仅把一个标志设成 true。

## 今日思考题

若新服务只接受 `claimOutbox` 和 `confirmOutbox`，但旧 Worker 与服务进程共享同一可写 DB 目录，新入口是否已经成为 Single Writer Authority？

答案：**不是**。旧 Worker 可绕过 RPC 直接更新 `recovery_outbox`。必须先剥夺旧进程的文件写权限或物理隔离部署。生产发布 **NO_GO**。

午练：候选服务端入口与 fail-closed 运行模式（不把 TypeScript 类型当授权）；晚练：旧进程/脚本的 OS 权限绕过与切换回滚测试。
