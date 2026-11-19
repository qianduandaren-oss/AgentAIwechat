# Day 90 晚练｜证据缺口与旧 FD / 回滚反例的发布阻断登记

2026-11-19（北京时间）｜Week 13 / Day 90｜18:00｜20–30 分钟

## 三段课串联

- 早课：冻结 deployment/release/attempt/host/namespace，preflight 和 cutover 每主机七项，两个主机共 28 格。元数据完整不等于采集真实。
- 午练：真正运行一次性 /proc 和 Linux UID 隔离实验；原始证据只作为局部 fixtureSignals，28 个格子继续 UNKNOWN，受信发布收据为 0。
- 晚练：新增只读发布阻断登记，把覆盖缺项、旧 FD 仍可写、危险回滚重新开放写入、签名/Challenge 未核验、真实 Consumer ACK 不存在等原因合并。**所有分支都只能 HOLD**。

## 接入工程

- `src/runtime/recovery-writer-cutover-release-blockers.ts`：复用 Day 90 早课的 `reviewWriterCutoverEvidenceCoverage()` 和午练的 `mapLocalLabsToCutoverUnknownMatrix()`，输出独立 blocker 原因及 UNKNOWN 数量。
- `src/demos/day90-evening-release-blockers-test.ts`：覆盖无收据、多主机缺项、错 attempt、重复记录、Worker 自报、cutover 早于 preflight、两条 Day 89 负向风险。即使全部 28 个**合成** PASS，结果仍 HOLD，`publishAuthorized=false`。
- `package.json`、`README.md`、GitHub Actions：增加 Day 90 晚练回归入口。

调用示例（两个主机、无生产证据）：

```typescript
const result = reviewDay90ReleaseBlockers({
  intent: "isolated_review",
  scope,
  nowEpochMs: Date.now(),
  receipts: [],
  localSignals: [],
  observedFixtureHazards: [
    "old_fd_writable_after_chmod",
    "rollback_restores_new_write_access"
  ]
});
// result.action === "hold"
// result.unknownCells === 28
// result.publishAuthorized === false
```

该代码中的 `scope` 由已有 Day 90 fixture 构造，实际可运行测试见 `src/demos`。

## 验收命令

```bash
npm ci
npm run test:recovery-writer-cutover-coverage
npm run test:recovery-writer-cutover-local-evidence
npm run test:recovery-writer-release-blockers
```

其中第二条真实 Linux /proc 检查仅在具备相关环境时执行；需要 Day 89 双 UID 验证时，需使用一次性 Linux CI 并显式设置 `DAY90_ENABLE_DAC_LAB=1`。不要在生产主机执行。

## 生产 NO_GO 边界

当前模块不验证受信主机全集，不执行 Ed25519 受信公钥验证，不持久消费一次性 Challenge，不检查真正的 OS FD/挂载全集，也不验证真实 Consumer ACK。观察过的旧 FD 和危险回滚反例是**隔离夹具中的风险复现**，不是生产环境已经发生事故的断言。28 条 synthetic PASS 只是元数据覆盖样本。

下一课 Day 91：把本次阻断登记与外部部署清单、独立见证者、公钥/Challenge、Consumer ACK 的受信证据来源逐项做契约化接入；仍不提前开放生产 GO。
