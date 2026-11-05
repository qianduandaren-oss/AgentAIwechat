# Day 76 晚练：Cutover TOCTOU 与旧入口隔离

日期：2026-11-05。早课：Single Writer Authority；午练：Fail-Closed Bootstrap；晚练：检查后旧 Worker 复活的 TOCTOU 风险。

新增 CutoverEvidenceGuard：在候选操作前重新采集六项部署证据；失败、缺失或异常一律 hold。测试覆盖首次通过、旧 Worker 复活、恢复后通过、证据源不可用。它不授予生产 publish 权限。

**关键限制**：recheck 仍然存在检查后变化窗口。必须由数据库级权限、部署 fencing 或独占写入服务持续约束旧实例；原始 acknowledge 与 legacy dispatcher 仍可被直接调用。生产 NO_GO。
