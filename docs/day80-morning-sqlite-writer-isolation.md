# Day 80 早课｜SQLite 单一写入者：用部署隔离真正阻断旧 SQL

日期：2026-11-09（Asia/Shanghai）｜Week 12 / Day 80｜20–25 分钟

## 继承 Day 79 的进展与未解决问题

- Day 78 已有 `SQLiteFencedOutboxDelivery`：在同一 SQLite 写事务验证 Writer Epoch、Lease、Outbox Version CAS。
- Day 79 已有 `RecoverySingleWriterCandidateService`、`reviewSingleWriterReleaseEvidence()`。这些是候选服务和**证据审查器**，不是 OS 权限实施工具。
- Day 79 负向测试故意成功执行旧管理连接的直接 SQL，证明旧 Worker 拥有 SQLite 文件写权限时可以绕过全部应用检查。
- 当前无真实可信 RPC/IPC 服务、真实 ACK 认证或数据库写权限隔离；生产继续 **NO_GO**。

## 核心问题：为什么同一个 OS 身份不可视为已隔离

Unix DAC 权限通常以 UID/GID 等身份执行；仅给不同的 Node.js 进程起不同名字，或在 JS 层封装 Singleton，不会撤销共享 UID 进程的 SQLite 写入能力。即使改变主数据库文件权限，也必须核对所在目录、SQLite 日志（WAL/SHM）、替换文件、软链接、持有中的文件描述符，以及部署中的挂载/容器权限。

**优先级**：最强的简化策略是旧 Worker、脚本、旧镜像**根本不挂载**数据库目录；Trusted Delivery Service 独占数据库目录挂载。只读挂载比不挂载更弱，数据库文件单独 `chmod 444` 更不能单独作为发布证据。

## 预期的信任架构（尚未实现）

```text
Untrusted / legacy Worker (uid 20020; NO SQLite volume)
       │
       │ authenticated + authorized RPC/IPC
       ▼
Trusted Delivery Service (uid 20010; owns SQLite volume)
       ├─ server-owned owner/epoch/clock
       ├─ Cutover / caller authorization
       ├─ trusted consumer ACK verification
       └─ BEGIN IMMEDIATE
          epoch + lease + version CAS
                    │
                    ▼
       /var/lib/recovery/agent.db
       /var/lib/recovery/agent.db-wal
       /var/lib/recovery/agent.db-shm
```

这里的 UID 只是设计示例，不表示本仓库部署已使用这两个身份。生产环境必须核对镜像实际 `id`、挂载卷 ACL、Pod 的 securityContext、capabilities、服务账户和工作负载调度/回滚策略。容器的 `user` 属性并非跨环境可证的权限隔离：若旧镜像以 root/特权或可绑定同一卷运行，仍可能绕过。

## 部署策略与切换顺序（候选计划）

1. 盘点所有旧 `RecoveryOutboxDispatcher`、raw `acknowledge()`、管理脚本/维护 Job/Sidecar/Init Container 的数据库写入口。
2. 在独立的测试/预发环境部署新的受信写服务，使用独立 OS 身份，单独挂载 SQLite DB 及其**整个目录**，而非只授予 db 文件权限。
3. 旧 Worker 不挂载 SQLite 目录；只保留**认证授权后的**业务 RPC/IPC 客户端接口。RPC 服务不能让客户端指定 epoch、workerId、consumer contract、时钟或 SQL。
4. 串行化 Cutover：停旧入口、收回旧镜像/Job 的存储挂载、确认没有持有旧可写文件描述符的存活进程，再允许受信服务接管 Writer Epoch。
5. 使用**真实旧镜像、真实 OS 身份与相同挂载策略**执行独立负向探针；回滚测试确保旧镜像也无法恢复 DB 挂载或 raw ACK。
6. 验证 RPC 鉴权、真实 ACK、Epoch/Lease/CAS、混合版本/重启/回滚，审查结果才可供外部安全发布流程使用。任何缺项继续 NO_GO。

SQLite 单写者事务并不意味着可以安全地在不受支持的共享网络文件系统上多主部署。若跨节点、跨主机必须共享状态，应考虑单主服务或迁移 PostgreSQL 等有服务端 ACL 的数据库。

## 负向探针矩阵（留给午练实现）

| 探针 | 运行环境 | 预期 |
| --- | --- | --- |
| Legacy DB file open + write transaction | 隔离的预发环境，真实旧 uid/镜像 | 文件不存在于其挂载命名空间，或写入返回 OS-level permission denied |
| Legacy DB directory create/rename | 同上，检查目录及父目录权限 | 无挂载或拒绝 |
| WAL/SHM 与持有中 FD | 服务已进入 WAL 后，检查旧进程 | 旧进程无可写挂载、无可复用旧 FD；涉及 WAL/SHM 的权限也不会成为旁路 |
| Same-image rollback / mixed version | 旧镜像重启或回滚后 | 仍无数据库可写路径，raw ACK 被拒绝 |
| Trusted Service 业务写 | 受信服务账户，受认证调用 | 可以做事务，但必须通过 Epoch + Lease + CAS |

探针必须避免在真实生产库上进行破坏性写入，采用隔离的预发数据库与可丢弃数据集。**不能**只拿测试里的 `exclusiveSqliteWriter:true` 等布尔值冒充 OS 拒绝证据。

## 三点记忆

1. Single Writer 指**不可绕过的数据库写入主体**，不是 Singleton，也不是只有一个 Node 线程。
2. 优先让旧进程**不挂载 DB 目录**；检查 WAL/SHM、父目录、旧 FD、特权容器和回滚路径。
3. 部署级权限、RPC/ACK 鉴权、SQLite 同事务 Fencing 是三层互补的防线；发布前必须有真实拒绝探针。

## 思考题

如果旧 Worker 被禁止读取 `agent.db`，但仍持有 SQLite 目录写权限并能替换数据库文件，这算完成隔离吗？

**答案：不算。** 对数据库文件、父目录、日志/辅助文件和旧进程已持有描述符的权限必须形成闭环；最稳妥的是旧 Worker 不挂载生产 DB 目录，且不能以特权或回滚方式重新挂载。

## 本日后续

- 12:00：在已有项目旁边实现**不接触生产数据**的隔离部署探针/配置检查骨架，并用负向案例验证“同 UID/有挂载→拒绝发布”。
- 18:00：真实 OS 身份/挂载证据标准、混合版本与回滚审查，强调模拟检查不等于生产验收。
- Day 80 不是七的倍数，不追加 Week Checkpoint。正式发布 NO_GO。
