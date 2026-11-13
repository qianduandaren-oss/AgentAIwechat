# Day 84 晚练｜事务信任围栏、崩溃回滚与旧版 SQL 旁路

2026-11-13 · Week 12 / Day 84 · **仅隔离实验；生产 NO_GO**

## 本次改动

- 延续 Day 78 `SQLiteFencedOutboxDelivery`，补齐遗漏的 `rotate()` 事务内 Trust Watermark 校验；Claim 和 ACK 在 Day 84 午练已使用同一个 DatabaseSync 事务校验。
- 新增 `day84-evening-trust-fence-boundary-test.ts`，涵盖策略更新前事务回滚、撤权后旧 Writer 的 Epoch 轮换/Claim/ACK 拒绝、受信新版本正常完成 Claim/ACK，以及重启后继续使用持久版本。
- **故意保留两个负向证明**：旧构造函数不传 `activeTrustWatermark` 可以执行轮换/Claim；直接掌握 SQLite 写连接的旧进程可以绕过 Trust/Epoch/Lease/ACK，伪造 dispatched。
- 本次实验用的是同步 SQLite 事务故障注入（抛异常并显式 ROLLBACK），**不是 kill -9 / 电源中断 / WAL 恢复验证**。同一数据库文件里的两个连接由 SQLite 串行化，不代表跨节点共享线性化。

## 运行

```bash
npm ci
npm run test:recovery-writer-trust-tx-contract
npm run test:recovery-writer-trust-tx-sqlite
npm run test:recovery-writer-trust-tx-evening
npm run test:recovery-fenced-outbox
npm run test:recovery-single-writer-candidate
```

## 生产阻断项

1. 旧 Worker 的 SQLite 文件/目录及 WAL、SHM 写访问未在真实部署排除；旧可写 FD 未排空。
2. 无水位的兼容构造路径仍开放，尚无可证明的单一生产创建入口和静态构造禁用措施。
3. 可写数据库权限本身可绕过 API Fencing；需要 OS UID、挂载和启动模式强制隔离。
4. 策略发布签名/认证、共享水位权威跨节点线性化、证书回收与轮换未完成生产验收。
5. 真实 Consumer ACK 验证、Consumer Inbox 去重与回滚演练缺少端到端证据。

**结论：测试可为候选代码提供局部保证，不能授予生产发布；NO_GO。**

## 下阶段

Day 85 起转向 **生产创建路径与隔离验收**：先消除无水位兼容构造被生产误用的机会，再用独立权限验证真实 SQLite/WAL/SHM 的旧 Writer 访问拒绝。
