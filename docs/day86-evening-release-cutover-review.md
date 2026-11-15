# Day 86 晚练｜混合版本、回滚复活与证据时效的切换审查

日期：2026-11-15（北京时间）｜Week 13 / Day 86｜18:00｜20–30 分钟。**生产 NO_GO**。

## 当天知识链

早课定义七项独立部署证据合同，午练在一次性 Linux 夹具中真实读取 /proc PID、starttime、可写 SQLite/WAL FD，但只证明自己创建的子进程退出与 FD 排空。晚练把既有 `reviewWriterReleaseEvidence()` 组合进 `reviewWriterCutoverRehearsal()`，扩展到三类发布失败：证据过期、混合版本写权限、危险回滚。

## 隔离候选评审顺序

1. 拒绝生产发布意图，复用 Day 86 早课证据完整性、目标 ID、新鲜度审查。
2. 审查与同一 deploymentId/releaseId 绑定的实例清单，拒绝 Worker 自报、库存不完整、时间过期和重复 ID。
3. 所有旧 Writer 必须不再 active；恰好一名 Trust-Bound Writer 具有活动数据库写权限；Reader 不可写；原始 ACK 入口必须声明关闭。
4. 回滚清单绑定同次发布并包含图片摘要；不允许旧镜像、旧数据库可写挂载、原始 ACK 入口或无水位构造路径复活。
5. 即便所有合成元数据一致，也只返回 `ready_for_isolated_cutover_rehearsal`，且 `publishAuthorized=false`。

```
Day 86 morning 七项证据 → Day 86 noon 内核局部证据
  → evening 元数据合并审查
  → 混合版本实例数 / DB 写权限 / raw ACK / rollback
  → HOLD 或仅进入隔离 rehearsal（永远不是 Production GO）
```

运行：`npm ci && npm run test:recovery-writer-release-cutover`。

反例测试：生产申请、缺少/过期/未知七项证据、错绑库存、旧 Writer 存活、第二位可写 Writer、零 Writer、原始 ACK 未关闭、回滚恢复旧镜像/旧挂载/ACK/Legacy Constructor，全部 HOLD。正向测试仅使用伪造的完整元数据，不能证明真实主机或部署控制面的权限。

**严禁**把镜像 digest 字符串、`inventoryComplete=true` 或 `observerKind=independent_host_probe` 当作签名证明。验证需要另一个独立且受认证的部署控制面，真实 OS 命名空间与 inode/FD 清单，挂载/回滚策略不可恢复性、真实 Consumer ACK/Inbox；CI 绿色也不是发布许可。

Day 87 继续设计真实部署采集器的身份与原始证据绑定，不重复本晚练合成审查。
