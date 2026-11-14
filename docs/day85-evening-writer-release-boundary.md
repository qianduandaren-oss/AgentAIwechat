# Day 85 晚练｜Writer 唯一入口扫描、WAL/SHM Linux DAC 与回滚反例

日期：2026-11-14；Week 13 / Day 85。状态：**隔离验证，生产 NO_GO**。

## 承接 Day 85 早课/午练

早课审查可信创建合同；午练把 `bootstrapRecoveredWriterTrust()` → `createIsolatedTrustBoundRecoveryWriter()` → `assertTrustBoundForIsolatedStartup()` 连接到现有 Day 84 的同库事务围栏。晚练不再重建 Factory，而是测试发布边界。

## 1. 当前仓库中的构造调用点

`scripts/day85-evening-writer-entrypoint-audit.mjs` 扫描 `src/runtime/**/*.ts` 中显式 `new SQLiteFencedOutboxDelivery(...)`。当前只允许 Factory 使用直接构造；其他 Runtime 文件出现新直接构造就失败。测试还校验 Factory 先 Bootstrap、注入水位、启动时验证以及永远 `publishAuthorized:false`。

**审计限制**：字符串扫描无法发现别名、动态执行、反射、其他 SQLite 写组件和部署后的旧二进制。`SQLiteFencedOutboxDelivery` 的可选 `options` 仍存在。Day 84 已证明无水位构造与直接 SQL 是真实旁路；此工具的 PASS 不是不可能绕过的安全证明。

## 2. 独立 OS 证据：SQLite + -wal + -shm

`scripts/day85-evening-wal-shm-identity-lab.mjs` 使用一次性 `/tmp/day85-evening-wal.XXXXXX` 目录建立真实 WAL 模式 SQLite，保持连接打开，确认 `agent.sqlite`、`agent.sqlite-wal`、`agent.sqlite-shm` 均存在。然后使用**另一个真实 Linux UID（nobody）**检验：

- 权限未隔离时：nobody 可以打开 DB、WAL、SHM 和目录新建文件（明确不安全的正向对照）；
- 目录 0700，三文件 0600 后：nobody 四个对象全部遭 OS 拒绝；
- 故意将模式回滚成世界可写：nobody 再次可以打开，证明“错误回滚配置”会重新开放写权限；恢复隔离后再次拒绝。

缺少 Linux、非交互 sudo、独立 UID、WAL/SHM、预期拒绝时，脚本报错，绝不把工具运行失败当作隔离成功。路径严格限定临时测试夹具。这里不依赖也不输出任何私密凭据。

**Day 80 `test:recovery-writer-stale-fd-lab` 已证明即便 chmod 拒绝新打开，既有可写 FD 仍能改文件。** 本次扩展的是 WAL/SHM 文件面和回滚导致权限复活；它不构成旧 FD 排空证明，不能代表生产容器挂载隔离。

## 运行

```bash
npm ci
npm run test:recovery-writer-trust-bound-factory
npm run test:recovery-writer-entrypoint-audit
npm run test:recovery-writer-wal-shm-os-lab
npm run test:recovery-writer-stale-fd-lab
```

## Release Boundary / 待补证据

| 条件 | 当前证据 | 发布结论 |
| --- | --- | --- |
| Day 85 strict candidate Factory | 午练集成回归 | 仍可绕过，NO_GO |
| Runtime 直接构造入口扫描 | 源码启发式扫描 | 不能证明运行时唯一，NO_GO |
| 独立 UID 对 SQLite/WAL/SHM 新打开拒绝 | 一次性 Linux fixture | 不是生产挂载证明，NO_GO |
| 撤权后旧 FD 是否清零 | Day 80 反例证明旧 FD 仍可写 | 缺排空证据，NO_GO |
| 错误回滚能否恢复遗留写权限 | 一次性 chmod 回滚复活写权限 | 阻断发布，NO_GO |
| 真实消费者 ACK / Inbox / 策略签发 | 实际生产数据尚未验收 | NO_GO |

Day 86 从旧二进制/FD/回滚的部署级隔离契约出发，继续补可审计的发布证据；不重复 TypeScript Factory 基础。
