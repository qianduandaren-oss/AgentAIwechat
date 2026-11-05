# Day 76 早课：Dispatcher Cutover 的写入权威与启动门禁

日期：2026-11-05。承接 Day 75 的 RecoveryVerifiedDeliveryGateway。

## 核心问题
Gateway 已实现 claim/confirm/inspect，但旧 RecoveryOutboxDispatcher 仍能通过 RecoveryOutboxStore.markAttempt → publish → markDispatched 绕过 SQLite Lease；SQLiteRecoveryOutboxDeliveryClaimer.acknowledge() 也仍接受可伪造的 source 字符串。安全封装存在不代表所有写入口已被封闭。

## 切换协议
1. **Inventory**：列出所有可更新 Outbox 的入口（legacy dispatcher、raw acknowledge、gateway、脚本/CLI/HTTP、数据库直写）。
2. **Trusted bootstrap**：服务端启动时验证发布模式、可信 Adapter、消费者幂等合同、SQLite 权威路径；配置缺失 fail closed。不要从请求参数选择生产 Adapter。
3. **Single writer**：生产模式仅允许经受信 Gateway 调用的 SQLite claim 与经认证的 confirm。旧路径要通过运行时权限、模块边界和数据库写权限隔离，不能只靠 README 禁用。
4. **Rolling deploy**：旧实例仍存活时，不得启用新模式；先停止旧 Worker、排空或隔离旧队列、核对 lease/Outbox、再放行新 Worker。混合版本要么有共享的强制门禁，要么 NO_GO。
5. **Acceptance**：对旧入口绕过、伪造 ACK、租约过期、进程重启和双实例竞争做故障注入，证明 Outbox 不会未经授权变成 dispatched。

## 代码审查边界
`src/runtime/recovery-outbox.ts` 里的 `RecoveryOutboxDispatcher.dispatchPending()` 直接调用 `markDispatched()`；`src/runtime/recovery-outbox-delivery-lease.ts` 的 `acknowledge()` 只校验 source 枚举与 lease，不执行密码学身份认证；`src/runtime/recovery-verified-delivery-gateway.ts` 的构造器仍接受任意 Adapter。今天仅确定启动门禁的纯策略，不声称已经切断旧写入口。

## 午练任务
在受信 bootstrap 增加 fail-closed cutover gate：仅在 legacyDisabled、verifiedAdapterConfigured、durableConsumerDedupeVerified、exclusiveSqliteWriter、noMixedVersionWorkers 全部由服务端可信证据确认时才允许生产启用。用 TypeScript 单元测试覆盖每个缺失条件。晚练再测试旧 Dispatcher 旁路与灰度回滚。

生产状态：**NO_GO**。
