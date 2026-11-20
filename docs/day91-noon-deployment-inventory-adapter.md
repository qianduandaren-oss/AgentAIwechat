# Day 91 午练｜只读 Deployment Inventory Adapter 与冻结快照漂移检查

2026-11-20（北京时间）｜Week 13 / Day 91｜12:00｜20–25 分钟

## 接上早课

Day 91 早课已经用 `planDay91CutoverProvenance()` 枚举 1 份可信部署清单、2 主机 × 2 阶段 × 7 检查（28 份 OS 证据），以及 1 份真实 Consumer ACK，共 30 项来源任务。此前传入的 `claimedInventory` 只是未经认证的调用方文本。

午练继续在同一个 Runtime 增加只读边界 `reviewDay91DeploymentInventory()`。**真正的生产部署控制面适配器没有接入**：当前在 CI 使用内存假适配器，`candidateMatched=true` 仍然只是候选匹配，不可解释为可信事实。

## API 设计

`src/runtime/recovery-writer-cutover-inventory-adapter.ts` 提供：

- `Day91DeploymentInventoryAdapter.readSnapshot(binding)`：只读异步查询，binding 仅来自预定义的 deployment/release/attempt。
- `Day91InventorySnapshot`：snapshotId、revision、host/namespace 全集、capturedAt 和 expiresAt。
- `Day91InventoryAnchor`：本次实验冻结的 snapshotId 与 revision；**目前由调用方提供，不构成受信 pin**。
- `reviewDay91DeploymentInventory()`：校验版本与范围绑定、快照新鲜度、主机全集是否漂移。返回 HOLD；任何路径 `publishAuthorized=false`、`authenticatedEvidenceCount=0`。

```typescript
const result = await reviewDay91DeploymentInventory({
  intent: "isolated_review",
  scope,
  expectedAnchor: { snapshotId: "fixture-snapshot-91", revision: "r1" },
  nowEpochMs: Date.now(),
  adapter: {
    async readSnapshot(binding) {
      // 隔离练习：替换成已经具备的内存快照，不连接生产
      return fixtureSnapshot;
    }
  }
});
// 若 fixtureSnapshot 匹配：
// result.candidateMatched === true
// result.action === "hold"
// result.publishAuthorized === false
```

示例的 scope 和 fixtureSnapshot 在测试文件里完整构造；不要将 `readSnapshot()` 的返回对象直接当作认证身份或不可变快照。

## 失败策略

| 场景 | reason |
| --- | --- |
| adapter 未接入 | inventory_adapter_not_connected |
| adapter 读失败 / 返回 null | inventory_adapter_read_failed / inventory_snapshot_unavailable |
| 缺冻结锚点、snapshotId 或 revision 不一致 | inventory_anchor_missing / inventory_snapshot_anchor_mismatch |
| 错 deployment/release/attempt | inventory_snapshot_scope_mismatch |
| 快照超时（300s）、过期 | inventory_snapshot_stale_or_expired |
| 新增/缺失主机、namespace 变更、重复 hostId | inventory_target_set_drift |
| 候选完全匹配 | inventory_candidate_matched_but_source_unverified |
| production_release | production_release_not_authorized |

## 运行

```bash
npm ci
npm run test:recovery-writer-cutover-provenance
npm run test:recovery-writer-deployment-inventory
```

新测试额外覆盖两次读取之间版本更新、多出一台主机、错 namespace、伪造 `verified: true` 标签、时钟异常与 mock 异常。预期全部 HOLD，无 GO。CLI/CI PASS 仅代表合同负向回归，不代表真实部署清单可信。

## 还没有做的事

- 在控制面独立进程中建立认证过的传输（如 mTLS），把对端身份映射到授权部署角色。
- 在受信源按 attempt 冻结不可变 inventory，使用服务端可信版本/签名或受保护只读存储提供独立 anchor，而非让 Worker 注入。
- 在切换点重新读取实际全集，证明无新增 host/namespace；验证 Day 89 旧 FD/回滚风险已在真实部署移除。
- 逐主机验证 Ed25519/Challenge 原始 OS 事实、真实 Consumer ACK 与外部审计锚点。

**发布状态：NO_GO。** 晚练将围绕三类来源的错绑和失效做端到端阻断，并在 Day 91 晚练追加 Week 13 Checkpoint。
