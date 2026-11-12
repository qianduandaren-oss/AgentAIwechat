# Day 83 早课｜可信策略版本水位：为什么 revision 不能只放在内存

日期：2026-11-12（北京时间）｜Week 12 / Day 83｜08:00｜20～25 分钟。

## 承接 Day 82 的真实缺口

Day 82 的 `RecoveryWriterMtlsTrustController` 持有进程内 revision 和当前指纹名单。
它支持撤权和连接派发前重查，但重启后仅凭默认 `minimumRevision=0` 可能误接受旧策略。
本次明确 **可信策略来源 → 持久版本锚 → 原子 CAS → 内存激活** 的顺序。
本节只交付类型与纯审查合同，不声称已做可信策略发布服务或持久化。

## 关键一致性约束

1. 持久 checkpoint 必须绑定 `deploymentId + revision + canonical policy SHA-256`。
   单纯 revision 不足以区分「同版本合法重启」和「同版本偷偷换内容」。
2. 信任来源应经过服务端独立认证；SHA-256 仅标识内容，不证明发布方。
3. 新策略必须先在受信、线性一致的存储中 CAS 推进水位，再暴露给新连接；
   CAS 冲突必须重读、重新评估，失败时保持关闭。
4. checkpoint 保存成功、进程激活前崩溃：重启时可接受 **相同 revision + 相同 digest**
   的精确重放（仍须重新认证策略来源并校验有效期）。当前 Day 82 Controller
   的 `install` 拒绝相同 revision，这是 Day 83 午练需要解决的接线缺口。
5. 若策略源不可用、checkpoint 不可读、部署不匹配、版本下降、同版本不同摘要、时钟失效
   或快照已过期：Fail Closed。不能加载默认的旧静态 `peers`。
6. 多个 Writer 实例不得各用本地文件独立提交版本；必须使用共享的受信串行化协调点。
   生产还需旧 Writer DB 挂载隔离及真正的消费者 ACK 验证。

## 今日新增代码

`src/runtime/recovery-writer-trust-watermark-contract.ts`：
- `RecoveryWriterTrustWatermark`：deployment / revision / policySha256；
- `RecoveryWriterTrustWatermarkStore`：持久化 load + compareAndSwap 接口；
- `AuthenticatedRecoveryWriterPolicySource`：只能由服务端认证的策略来源适配器实现；
- `reviewRecoveryWriterTrustBootstrap`：只读审查，旧版、同版换内容、无持久锚一律 hold；
  允许相同版本/摘要的「重启候选」，但不授权发布。

`src/demos/day83-morning-trust-watermark-contract-test.ts`：纯合同负向测试。
运行：`npm run test:recovery-writer-trust-watermark-contract`。

## 午晚练路线

12:00：在原工程中实现一次性 SQLite checkpoint 的原子 CAS / 多实例冲突，
并接入可信策略快照的重启路径。不能把 `trustedSourceAuthenticated` 布尔值当成密码学认证。
18:00：注入崩溃点、旧策略回滚、策略源不可达、双实例竞态，产出发布阻塞检查表。

## 限制

当前仅 types + pure reviewer：尚无 SQLite Watermark Store、策略签名校验、可信分发、
跨进程一致性、生产凭据撤权、旧进程 SQL 隔离或真实 Consumer ACK。
`publishAuthorized` 恒为 false，**生产 NO_GO**。
