# Day 92 早课｜Authenticated Inventory Snapshot：先建立信任根，再谈冻结

日期：2026-11-21。Week 14 / Day 92（08:00）。生产 **NO_GO**。

Day 91 只读 Adapter 的 snapshotId、revision 和 host 列表只是候选数据。Day 92 早课先建立**冻结清单的规范化字节身份**，不将其冒充已认证快照：

1. **信任根**：受信部署控制面以服务端认证身份和有权限的查询获得真实运行实例全集（host、mount namespace、release/attempt）；客户端不可选择源或自报 trusted。
2. **冻结线性化点**：受信控制面需要持久不可变快照/版本与 CAS，绑定 deploymentId/releaseId/attemptId；新增、删除、回滚或版本漂移必须中断本次切换、重新冻结并重采。
3. **完整性标识**：host 顺序规范化；domain separation + 完整快照字段哈希，不仅哈希 host 清单。散列只识别字节，不证明“谁提供的”或“是否全集”。
4. **消费范围**：后续 Day 90 的 28 项证据和 Day 91 Collector/Consumer ACK 必须绑定同一冻结快照。当前无真实控制面、无签名信任根、无持久 CAS，依旧 HOLD。

本轮新增 `src/runtime/recovery-writer-inventory-freeze-candidate.ts`，复用 `reviewDay91DeploymentInventory()` 做严格候选校验；`canonicalDay92InventoryManifestBytes()` 固定字段顺序并对 host 排序，`planDay92InventoryFreezeCandidate()` 给出候选 SHA-256，固定 `authenticatedInventoryCount=0`、`durableFreezeCommitted=false`、`publishAuthorized=false`。

运行：

```bash
npm ci
npm run test:recovery-writer-inventory-freeze
```

测试覆盖 host 交换顺序后摘要不变、attempt/revision/namespace 变化后摘要改变、快照缺失、错绑、重复主机、过期和生产请求拒绝。**这只是构建未来可信冻结流程所需的输入身份；并未冻结真实部署。**

Day 92 午练起点：在现有只读适配器边界之上定义受信 Inventory Source 的**服务端验证接口和持久冻结 CAS 语义**，禁止让任意 Worker 直传权威快照或用调用方布尔值表示认证。晚练再组合并发变更和恢复场景。
