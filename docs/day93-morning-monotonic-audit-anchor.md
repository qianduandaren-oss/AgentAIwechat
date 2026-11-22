# Day 93 早课：独立单调水位与外部审计信任边界

日期：2026-11-22｜Week 14｜主题：External Monotonic Audit Anchor

## 承接 Day 92

Day 92 已完成 SQLite 不可变 Inventory Freeze、单次 attempt 的 CAS 作废与联合只读证据审核，但演示表明：有权修改 SQLite 的旧 Writer 可以同时回滚 state/version/manifest；若审核器读取的本地 pin 也被恢复，完整性检查可能看起来正常。

## 核心概念

* **Monotonic checkpoint**：同一 deployment/release/attempt 的审计 sequence 只递增，不允许覆盖过去的撤销历史。
* **Trust-domain separation**：检查点来自独立受信控制面，签名、身份、权限和持久层均与 Worker/Inventory SQLite 分离。
* **Rollback detection**：本地 freeze version 小于独立检查点中的 version 时，说明本地状态可能被恢复；一律 HOLD。
* **Read-only comparison != authority**：本课的 reader 是内存测试注入，且没有外部签名或独立存储。即使所有字段吻合，也仅是候选，不是认证。

```text
Worker/Inventory SQLite (Day 92)          独立可信控制面（尚未接入）
state/version/manifestSha256       ←→     signed / append-only checkpoint
           |                                  |
           +-- Day 93 readonly comparison ---+
                        |
           不一致 / 消失 / 回滚 / 过期 → HOLD
           一致但未认证               → HOLD
```

## 现有工程改动

- `src/runtime/recovery-writer-inventory-audit-anchor.ts`：为独立审计服务定义只读 reader、候选检查点 schema、绑定、单调版本与时效的 fail-closed 检查。
- `src/demos/day93-morning-inventory-audit-anchor-test.ts`：结合 Day 92 的真实临时 SQLite，验证作废后回滚、错绑、断连、过期、恶意声明和双域同时回滚的反例。
- 运行 `npm run test:recovery-writer-inventory-audit-anchor`。

**限制：**不签名、不验证 mTLS/OIDC、不实现外部 WORM 日志/事务 CAS，不授予生产权限。外部检查点应由部署控制面单调追加，可信服务端获取 immutable revision 并核验身份；单靠 `claimedAuthenticated` 或另一张 SQLite 表不具备独立性。后续午练实现隔离的持久 checkpoint 演练与并发/崩溃恢复，晚练验证同域与跨域回滚的边界。

**发布结论：生产 NO_GO。**
