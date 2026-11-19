# Day 90 早课｜发布切换证据编排：按主机双时点收集，不允许拿旧 PASS 冒充新现场

日期：2026-11-19（北京时间）｜Week 13 / Day 90｜08:00｜20–25 分钟

## 继承 Day 89

Day 89 在一次性 Linux 环境证明了两个反例：收紧文件权限后旧可写 FD 可能仍能写；危险回滚可以重新赋予 Worker 新打开 DB/WAL/SHM 与目录的写能力。CI 成功观察反例不等于漏洞关闭。旧管理 API 与生产部署隔离依然未解决。

## 要解决的工程问题

Day 86 的七项证据只审单份报告，Day 87 追加 Ed25519 与 Challenge，Day 88–89 验证授权及 OS 权限的局部边界。真正准备切换时还要解决：

- 按受信发布控制面预先确定 **全部主机和 mount namespace**，避免只交一台 PASS 的报告；
- 对每台主机分别在 **preflight 与 cutover** 两个时间点收集 Day 86 七项检查；
- 每份报告绑定 deploymentId、releaseId、attemptId、hostId、mountNamespaceId，拒绝跨发布复用；
- 切换点重新采集，要求 cutover 时间严格晚于 preflight；过期、缺项、重复、UNKNOWN 全部 HOLD；
- 即使形状完整，也必须再经过 Day 87 的受信验签/一次性挑战和真实独立 OS 采集器；不可直接转生产 GO。

```text
控制面冻结 release/attempt + 目标主机/命名空间
  → preflight 每 host × 7 检查
  → 旧 Worker 退出 / PID starttime + FD 清场 + DB/WAL/SHM 拒写
  → 受限切换
  → cutover 每 host × 7 检查（必须重新采集）
  → 受信签名/挑战/原始证据/版本及 rollback 校验
  → 仍仅隔离候选；生产 NO_GO
```

## 本次落实

- `src/runtime/recovery-writer-cutover-evidence-coverage.ts`：导出两阶段、逐 host 的任务列表与 `reviewWriterCutoverEvidenceCoverage()`；只验证**元数据覆盖率与时序**，没有冒充真实探针。
- `src/demos/day90-morning-cutover-evidence-coverage-test.ts`：两台主机 2 × 7 × 2 = 28 个合成报告的正例；生产意图、缺项、重复、错 host/namespace/attempt、Worker 自报、UNKNOWN、过期与时间倒序均 HOLD。
- `npm run test:recovery-writer-cutover-coverage`：编译 + 回归。
- 此模块不会自动将所有检查标记为 PASS；合成正例也只返回 `coverage_complete_for_isolated_attestation` 且 `publishAuthorized=false`。

## 后续衔接

午练将把 Day 86/89 Linux 采集实验的**可验证局部输出**映射成覆盖率清单，未知事项保持 UNKNOWN，不得凭空补齐七项。晚练检查多主机缺失、证据断链、回滚清单与旧 FD 清场的负向结果。

本次不创建生产采集器，没有独立签名者身份认证、完整 mount/PID/FD 库存或 Consumer ACK。生产仍 NO_GO。
