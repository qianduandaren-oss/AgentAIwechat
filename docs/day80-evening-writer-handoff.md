# Day 80 晚练｜旧 FD、混合版本与回滚：为什么 chmod 不够？

日期：2026-11-09（北京时间）；Week 12 / Day 80；20–30 分钟。

## 链接 Day 80 早午练

早课定义 OS 身份与数据库目录的强制边界；午练用不同 UID 在一次性 /tmp SQLite 文件上复现新打开数据库和创建目录条目被拒绝。晚练增加**旧可写文件描述符**反例，并审查混合版本与回滚的切换前提。

## 关键结论

- `chmod 0600 agent.db` **不会自动撤销已打开的可写文件描述符**；只要旧进程还活着，Linux DAC 的权限变更不能替代停止进程和关闭 FD。
- 同 UID、数据库目录 / -wal / -shm 可写、旧容器可重新挂载、raw ACK 入口未封闭都属于 NO_GO。
- 即使部署清单六项全部为 true，`reviewSqliteWriterHandoff()` 仍只返回 `ready_for_external_enforcement_review`，**publishAuthorized=false**。布尔值不是权限验收证据。
- 回滚镜像不能回滚数据库挂载权限；混合版本同时运行时，旧镜像必须没有 DB 直写能力。

## 可重复运行（一次性 Linux 测试数据）

```bash
npm ci
npm run test:recovery-writer-handoff
npm run test:recovery-writer-stale-fd-lab
```

后一个脚本不依赖用户机器；需要 Linux、Node.js 22、`nobody` 和无交互 sudo（CI Runner）。在 `/tmp/day80-evening-fd-lab.XXXXXX` 初始化一次性**普通文件** `agent.db`，非生产 SQLite 数据库：

1. 旧身份 `nobody` 在权限放宽时以 `r+` 打开文件并保持 FD。
2. 控制进程将文件设为 0600、目录设为 0700。
3. 全新启动的 `nobody` 进程需返回 `FRESH file=denied directory=denied`。
4. 旧进程仍用**先前打开的 FD**完成写入，预期出现 `FD_WRITE_OK`。
5. 父进程校验文件值为 `X` 后，清理临时数据。

此反例模拟权限收紧的过渡瞬间，**并未在打开的真实 SQLite 连接上执行 WAL 写事务**，因此不等于验证生产 DB。新旧实例之间的 RPC 调用和真实消费者 ACK 也不在本脚本范围内。

## 外部部署验收清单

| 故障注入 | 强制验证方法 | 预期 |
| --- | --- | --- |
| 旧进程存活、FD 未关闭 | 同部署 PID / fd / proc 或等价运行时检查 | 不允许切换；旧进程退出、FD 回收 |
| 旧镜像+新镜像混合 | 真实旧镜像/UID/挂载运行直写拒绝探针 | 数据库文件、父目录及 -wal/-shm 不可写 |
| 旧管理脚本与 Sidecar | 实际镜像权限与目录挂载检查 | 不得写库或重新挂载 |
| 旧镜像回滚 | 在隔离预发完成回滚演练及直写拒绝探针 | 不恢复 DB 挂载、raw ACK |
| 真实 RPC / Consumer ACK | 独立认证与授权集成测试 | 伪造身份/ACK 被拒绝 |
| Epoch + Lease + CAS | 双连接/多进程竞争及崩溃恢复测试 | 事务内拒绝旧代次 |

保留生产 **NO_GO**，直到真实部署的独立证据及安全审查完成。

## 可重复验证的两种不同结论

`npm run test:recovery-writer-handoff` 测试候选政策在任一缺失字段时 fail closed；`npm run test:recovery-writer-stale-fd-lab` 实际复现已打开 FD 仍可写。这两个通过都不应被解释为生产单一写入权威已建立。
