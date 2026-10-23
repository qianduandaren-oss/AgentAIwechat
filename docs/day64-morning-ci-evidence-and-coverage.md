# Day 64 早课｜同一 Commit 的 CI 证据与 Recovery 发布门禁

日期：2026-10-24（Asia/Shanghai）

## 为什么今天检查 CI

Day 63 已合入 Control 可选来源字段、`RECOVERY_FINALIZATION_SCHEMA` 共享声明、结构扫描器修复和测试。不能继续沿用“最新 main 未执行 Build”的过期结论：`fb642643e9d9bc5bb5b13f233ddfe2917283e409` 已经有一次 GitHub Actions Runtime Tests **success**，Run ID `39936462821`。

具体证据：[Runtime Tests run 39936462821](https://github.com/qianduandaren-oss/AgentAIwechat/actions/runs/39936462821)。

## 证据范围

这个成功的工作流使用 Node.js 22、`npm ci`、`npm run build`，并执行既有 Runtime、Durable Recovery、Checkpoint、SQLite 恢复、Recovery Service、Preparation、Transition Committer、Command/Outbox、Orchestrator 等回归。

此前工作流**没有覆盖**：
- `node scripts/day63-contract-landing.mjs .`
- `node --test scripts/tests/day63-contract-landing.test.mjs`
- `npm run test:recovery-unit-of-work`

因此“Build 和工作流列出的回归已通过”是有证据的；“所有 Recovery 回归/完整 UoW 合约已通过”没有证据。

## Day 64 新增的 CI 验证

`.github/workflows/runtime-tests.yml` 在原有步骤基础上增加上述三步，不删除旧测试。此变更提交为 `7c353f53c835be77c3940acf31a374127fdf9080`。

**本轮已核验新 CI：**工作流扩展提交 `7c353f53c835be77c3940acf31a374127fdf9080` 对应 Runtime Tests Run `40042467983` 为 `completed/success`，新增兼容扫描器、七项回归和 `test:recovery-unit-of-work` 步骤均成功。证据链接：[Run 40042467983](https://github.com/qianduandaren-oss/AgentAIwechat/actions/runs/40042467983)。此证据绑定该 commit，不自动外推到后续 commit。

## 尚未具备的 Atomic Recovery 条件

- `SQLiteRecoveryFinalizationUnitOfWork.commit()` 当前仍无条件执行 Checkpoint UPDATE、version +1。
- Control-only 的 `compare` / `cas_update` Write Set 和事务内不可变命令身份校验尚未合入。
- `RecoveryOperationService.execute()` 可在新 Finalizer 外独立保存 Control；旧 Orchestrator 在 `executor.execute()` 后仍有 terminal CAS。
- 同库约束、正式入口异常注入、COMMIT 丢响应的 ResultSnapshot replay 与单终态写入所有权尚未验收。

**状态：兼容层 CI BASELINE PASS（旧 SHA）；新 CI 扩展 PASS（7c353f53）；Atomic Cutover NO_GO。**

## 验证用命令（针对完整 main checkout）

```bash
npm ci
npm run build
node scripts/day63-contract-landing.mjs .
node --test scripts/tests/day63-contract-landing.test.mjs
npm run test:recovery-unit-of-work
npm run test:recovery-operations
npm run test:durable-recovery-operation
```

## 接下来课程顺序

午练：在当前 `SQLiteRecoveryFinalizationUnitOfWork` 的接口和测试上实现按需 Checkpoint/Control compare/CAS，并保留完整事务回滚。

晚练：结合 Day 64 的真实 CI 证据复盘覆盖缺口，列出 Prepare 无提前落库、唯一 terminal writer、身份/版本/Outbox 失败注入的集成验收清单。Day 64 非阶段总结日。
