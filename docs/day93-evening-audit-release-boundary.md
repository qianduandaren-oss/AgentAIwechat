# Day 93 晚练｜冻结清单与审计水位联合审查：单库回滚可见、双库同域回滚仍有缺口

日期：2026-11-22（Asia/Shanghai）。衔接 Day 93 [早课](day93-morning-monotonic-audit-anchor.md) 的外部单调水位合同，以及 [午练](day93-noon-isolated-audit-checkpoint-cas.md) 的第二个 SQLite 文件与追加哈希链。

## 合同

新增 `reviewDay93AuditReleaseBoundary()`，组合以下现有模块而不重新实现其规则：

- Day 92 `reviewDay92FrozenCutoverBoundary()`：冻结版本/摘要和 Day 91 的 Inventory、Host、Consumer 证据断链。
- Day 93 `reviewDay93AuditAnchorCandidate()`：读取候选 Audit Reader 与 SQLite Freeze 比对版本、摘要、attempt 和时效。
- 输出单一 `blockers` 列表，保留各自的 `auditReason`、`freezeReason`、`evidenceChainReasons`。**即使本地数据看起来完整也固定 action=hold、publishAuthorized=false。**

## 两种不同的回滚

1. Inventory 本地从 invalidated/v2 回到 frozen/v1，第二个 SQLite 仍持有水位 v2：`sqlite_rollback_suspected_anchor_ahead`，HOLD。
2. 有数据库 owner 权限的同一 OS 身份将两个临时 SQLite 文件都退回 v1，同时把调用方 pin 退回 v1：所有旧摘要都可验证，返回 `checkpoint_candidate_consistent_but_source_unverified`；这**不是安全成功**，说明还缺真正独立、可认证且防回滚的外部高水位。

同时覆盖 Inventory revision 漂移、Reader 断连、审计哈希链篡改、直接 production_release 意图，均 HOLD。

## 运行

```bash
npm ci
npm run test:recovery-writer-inventory-audit-checkpoint-cas
npm run test:recovery-writer-inventory-audit-release-boundary
```

测试只创建 /tmp 下的临时数据库；不会触碰实际部署主机、外部服务、生产密钥、真实消费系统或发布权限。

## 发布阻断边界

- 两份文件不等于两个信任域；同一管理员能回滚两份文件，SQLite 触发器/哈希链不足以防持权者重写历史。
- 后续真实实现需要独立身份、强制读写 ACL、不可回滚单调存储、经过认证且具备新鲜度的查询（含 release/attempt 绑定），以及真实 Host Collector 和 Consumer ACK。
- 旧 FD 全量清场、危险回滚权限路径和生产 Inventory 全集仍未验收。所有实验 PASS 只是负向检测有效，**生产 NO_GO**。
