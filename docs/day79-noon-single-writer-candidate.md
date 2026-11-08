# Day 79 午练｜受信服务端候选入口与 Fail-Closed Bootstrap

日期：2026-11-08（Asia/Shanghai）｜Week 12。

## 基于已有代码继续

保留 Day 78 `SQLiteFencedOutboxDelivery` 的同库事务；复用 Day 76 `CutoverEvidenceGuard` 和 Day 75 `reviewConsumerAckBinding`。新增 `RecoverySingleWriterCandidateService`，实现 Day 79 早课 `RecoverySingleWriterServicePort`，不增加另一套 SQLite 业务表。

调用方只能提交 outboxId、eventId、leaseToken 与未经信任的原始 ACK。可信身份、Epoch、消费者合同、时钟、验证器都由服务端构造依赖注入，不允许调用方传入。

```
bootstrapSingleWriterCandidate()
   ├── 验证候选配置
   ├── 收集 Cutover 六项证据，任一 false / 异常 → hold
   ├── 读取受信 Writer 快照，缺失 → hold
   └── ready_for_candidate_tests (publishAuthorized=false)
        ├── claimOutbox → 重查证据、身份 → SQLite epoch+lease+CAS
        └── confirmOutbox → 重查证据、身份
                            → VerifiedConsumerAckAdapter.verify()
                            → 再次重查 Cutover/身份/时间
                            → reviewConsumerAckBinding()
                            → SQLite epoch+lease+CAS
```

## 验证

`npm ci && npm run test:recovery-single-writer-candidate`

测试验证六项证据不全拒绝启动、正常候选领取、ACK 验证失败不改变状态、身份不匹配、认证期间混合版本变化被重查拒绝、控制器掉线、Writer Epoch 被 B 接管后 A 无法 ACK、B 过期后重新 Claim 并确认。

这些是**受信依赖的模拟测试**，尤其模拟 ACK verifier 不是密码学认证。没有真实 RPC、真实消费者签名验证、OS 账户权限隔离、混合进程证明或 CI 通过证明。Cutover evidence check 仍有 TOCTOU；真正的 Single Writer Authority 要求旧进程无法直接写 SQLite 文件，且回滚不得恢复旧路径。生产 NO_GO。
