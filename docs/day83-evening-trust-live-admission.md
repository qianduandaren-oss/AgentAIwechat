# Day 83 晚练｜活跃实例失效、同库版本竞争和 Fail Closed

日期：2026-11-12（北京时间）｜18:00｜20～30 分钟。

本次继续 Day 83 午练的持久信任水位。旧进程 A 即使仍持有 Day 82 版内存指纹表，也必须在 Day 81 Admission **委派前**调用 `RecoveryWriterDurableTrustAdmissionGate.authorize()`：读取**同一受信 SQLite Store**的持久 `deploymentId/revision/policySha256` 和受信策略 Source 当前字节，重新计算 SHA-256；任一不一致、源不可达、数据库错误均拒绝委派。新增 `beforeDelegate` 为可选回归兼容 Hook，生产不得把缺少 Hook 的实验服务当成安全部署。

- Day 83 午练冷启动 Bootstrap 成功后返回不可变 `activeWatermark`，将它固定到 Gate（不是用新的 store.load() 猜测当前 Controller 对应版本）。
- Day 81 Admission 在 ACL 异步重查以后、审计与原有 Handler 前重查 Gate；超时和 Abort 后仍会再次拒绝。
- `npm run test:recovery-writer-trust-live-admission` 在一次性 SQLite 两连接上覆盖旧内存 Caller 仍在但权威水位已变、ACL 等待期间 CAS 前进、CAS 后冷启动精确恢复、策略源失联、摘要损坏、回滚、数据库不可用。
- 本次测试使用模拟受信策略 Source 和模拟 Outbox Handler；不连接真正的生产 TLS、消费者或数据库。

**尚未解决的竞争**：`authorize()` 读取策略源与 Store 并非同一事务；检查返回后，另一实例可在委派前修改水位（TOCTOU）。生产需要可证明的 *fencing*：例如使策略 Epoch/版本在 **Writer 实际写事务内**被同库校验，或者对更新、派发使用共同的线性化协议。不能因本实验通过就承诺即时跨进程撤权。多个实例如果各用独立 SQLite 也不构成共享权威。

完整生产验收还缺真正的认证策略发布与版本防回滚、跨节点一致性、旧 DB 挂载/FD/WAL/SHM 隔离、可靠 Consumer ACK 和持续审计。**NO_GO / publishAuthorized=false**。
