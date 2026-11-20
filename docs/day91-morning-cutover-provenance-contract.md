# Day 91 早课｜发布证据来源与受信边界合同

2026-11-20（北京时间）｜Week 13 / Day 91｜08:00｜20–25 分钟

## 从 Day 90 继续

Day 90 已经冻结了 deployment/release/attempt 的范围、两主机两阶段的 28 个检查单元，并把缺失/错绑/旧 FD/危险回滚转换成 NO_GO 原因。**覆盖率、真实性、授权是不同的三层。** Day 91 先确定上游可信来源，再接入真实身份和采集。

## 三类上游证据

| 来源 | 必须验证的内容 | 谁不应该决定这些 |
| --- | --- | --- |
| 受信部署控制面 Inventory | 实际 host/namespace 全集、snapshotId、deployment/release/attempt 绑定、快照版本、快照有效期 | Worker / Collector 自报主机清单 |
| 独立主机采集器 | preflight + cutover 七项逐主机原始 OS 事实、Ed25519 pin、公钥撤销、一次性 Challenge 事务消费、时间戳 | 单靠 observerKind 字符串 / SHA-256 形状 |
| 真实 Consumer ACK | mTLS Peer/服务端身份、实际处理结果、attempt/release 关联、幂等及旧原始 ACK 入口关闭 | Worker 或部署脚本伪造一个 ACK JSON |

另需将审计摘要锚定至控制数据库之外的受信系统，否则同库 SQL 可同时修改日志与摘要。

## 模块边界（只生成需求，永远不会返回 GO）

`src/runtime/recovery-writer-cutover-evidence-provenance.ts` 增加：

- `Day91ClaimedInventorySnapshot`：演示调用方声明的候选清单；无论 claimedSource 写什么均非认证结果。
- `Day91ProvenanceRequirement`：1 份受信 Inventory、28 项独立主机采集、1 项 Consumer ACK，共 30 项来源任务。
- `planDay91CutoverProvenance()`：检查候选快照绑定与目标全集一致性，并把缺失的可信适配器/OS 验签链/ACK/独立审计列为 HOLD。它不接受外部声称的 verified=true 来授权发布。

运行：

```bash
npm ci
npm run test:recovery-writer-cutover-provenance
```

该测试覆盖全量 30 项需求、空/重复主机、跨 attempt/namespace、伪造 deployment_controller 来源标签、生产发布意图，所有结果 `publishAuthorized=false`。

## 后续工程顺序

午练：用只读、受信部署 Inventory Adapter 接口引入真实控制面返回；即使没有实际部署连接，必须明确地区分“受信适配器未接入”与“候选数据形状匹配”，不能自行声明可信。

晚练：把来源缺失、失效和错绑做端到端拒绝回归；Day 91 是 Week 13 的第 7 天，晚练附阶段总结与 Checkpoint。严禁将本实验合同当作生产发布网关。
