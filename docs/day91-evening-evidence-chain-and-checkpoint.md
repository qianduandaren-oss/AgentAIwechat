# Day 91 晚练｜三类发布证据断链与 Week 13 Checkpoint

日期：2026-11-20。范围：Week 13 / Day 91（18:00）；生产 **NO_GO**。

本次继续使用 Day 90 覆盖矩阵、Release Blocker Register，以及 Day 91 早课来源合同和午练只读 Inventory Adapter。新增 `reviewDay91EvidenceChain()`，把 Inventory、Host Collector、Consumer ACK 三类候选证据串成可解释的拒绝发布结果。

- **Inventory**：无 Adapter、版本/目标变化、快照过期均 HOLD；即使内存候选匹配，也没有真正经过部署控制面认证。
- **Host Collector**：28 格合成 PASS、伪造 observerId 与摘要也只是元数据覆盖；真实 OS 证据、Ed25519 公钥 pin、一次性 Challenge/签名消费和完整主机范围未被验证。
- **Consumer ACK**：ACK 缺失、跨 attempt、过期、原始 ACK 入口未证明关闭全部 HOLD；即使字段齐全且 `claimedAuthenticated=true` 也不是受信 Consumer 身份。
- **旧 FD 和回滚**：Day 89 隔离夹具曾真实复现旧 FD 可写和回滚恢复写权限；不等于生产已整改。
- **外部审计**：仍缺独立防篡改锚点。

执行：

```bash
npm ci
npm run test:recovery-writer-evidence-chain
```

测试使用内存快照和合成收据，覆盖来源错绑、漂移、28 格假 PASS、ACK 断链、生产请求和风险登记；不访问生产库或密钥。所有结果 `action=hold`、`authenticatedEvidenceCount=0`、`publishAuthorized=false`。

[Week 13 阶段 Checkpoint](checkpoints/week13-day91.md)。

下一步 Day 92 先设计经认证 Deployment Inventory Snapshot 的获取与冻结机制（真实连接仍须验证），不重复 Day 90 28 格覆盖率或 Day 91 内存候选适配器。
