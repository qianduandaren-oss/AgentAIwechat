# Day 85 早课｜唯一可信 Writer 创建入口：先关兼容旁路

2026-11-14 · Week 13 / Day 85 · **仅候选代码，生产 NO_GO**

## 从 Day 84 的反例出发

`SQLiteFencedOutboxDelivery` 的历史构造函数允许不传 `activeTrustWatermark`，而 `assertTrustInTransaction()` 会直接跳过。Day 84 晚练证明这能继续 Rotate / Claim，直接 SQLite 写连接还能绕过所有 TypeScript 保护。只给新调用者增加 Factory 并不能移除旧入口；更不能收回已有旧进程的 FD。

## 设计中的生产入口

```text
受信 Bootstrap（来源认证 / 同库持久水位）
  → 强制可信 Factory（禁止可选 watermark）
  → DB 路径由服务端受控配置给出
  → OS 权限/挂载/FD 外部验收（单独证据）
  → 只能由 Writer 进程创建 SQLite 写连接
  → Rotate / Claim / ACK 同事务 Trust + Epoch + Lease/CAS
```

- `reviewRecoveryWriterCreationBoundary()` 是**纯、不可授权生产的合同**，对缺失信任水位、Legacy 路径、部署/版本/摘要不匹配直接 HOLD。
- 即便它返回 `ready_for_isolated_factory_test`，也仅表示可执行下一阶段隔离 Factory 实验；`publishAuthorized=false`。
- TypeScript `private`、工厂封装、路径字符串、布尔部署声明、CI 测试均不构成不可伪造的系统级写权限；必须使用 OS 身份/目录权限/挂载和旧 FD 排空证明。
- **不修改历史构造函数**，避免打断 Day 78–84 回归；后续先实现可信 Factory 和生产接线限制，再逐项消除 Legacy 生产调用路径。

## 运行

```bash
npm ci
npm run test:recovery-writer-creation-boundary
```

## 预期负向场景

严格入口 + 匹配水位仅允许隔离测试；Legacy 直接构造、缺少 Bootstrap/Writer 水位、版本回退、同版不同摘要、部署不匹配、任何 `production_release` 请求全部 HOLD。

## 明确的生产阻断项

旧 Worker 的直接 SQL、SQLite/WAL/SHM 文件及目录写权限、继承或已打开 FD 仍未由真实部署隔离；尚无强制生产 Factory、受信全局策略发布/水位协调和真实 Consumer ACK 端到端验收。**NO_GO**。
