# Day 86 午练｜独立采集 Linux 进程 / FD：局部事实不等于部署证明

日期：2026-11-15（北京时间）｜Week 13 / Day 86｜12:00｜20–25 分钟。生产 **NO_GO**。

## 承接早课

Day 86 早课的 reviewWriterReleaseEvidence() 要求七类部署事实，但只检查输入元数据，无法证明来源。午练做一次**真实 Linux 内核 procfs 观测**：父进程创建一次性 SQLite WAL 数据库，子进程作为旧 Writer 打开可写 FD；父进程通过 /proc/<pid>/fd、fdinfo 和 /proc/<pid>/stat 读取内核观察值，再让子进程退出并验证其原身份（PID + starttime）不存在。所有操作限于自己生成的临时进程和 /tmp/day86-noon-fd-*，不会扫描用户主机或生产目录。

## 实际工作流

    父进程（本机观察者，未被认证为部署控制面）
      → mkdtemp /tmp/day86-noon-fd-XXXXXX
      → fork 旧 Writer 子进程
      → Node DatabaseSync 打开 agent.sqlite（WAL）
      → /proc/<pid>/fd + fdinfo 验证可写 SQLite FD
      → evidence: legacy_processes_exited=fail / legacy_writable_fds_drained=fail
      → 子进程主动 close SQLite + exit；父进程等待回收
      → PID/starttime 不再对应同一旧进程
      → evidence: 这两项 PASS；另五项 UNKNOWN
      → Day 86 早课审查器 HOLD（缺 DB/WAL/SHM 等部署证明）

## 运行

    npm ci
    npm run test:recovery-writer-host-fd-probe

- 脚本路径：scripts/day86-noon-host-fd-probe.mjs
- 环境：Node.js 22+、Linux procfs、仓库编译后的 Day 86 早课合同；不需要 sudo、API Key 或外部网络。
- 负向：持有可写 SQLite FD 时，退出与排空状态必定 FAIL；无法读取 procfs、缺少 FD、无法按预期结束都应失败，不能当作成功。
- 正向：仅本实验所创建的子进程退出，且其相同 PID/starttime 不再存在时，才记录这两项局部 PASS；其余五项 UNKNOWN 导致总审查 HOLD。
- SHA-256 是本地观测内容摘要，**不等于**主机采集器签名。observerKind 可由代码填写，父进程不具备生产环境认证身份。

## 无法证明的事实

未覆盖实际部署的全部旧进程、容器 mount namespace、旧 UID 对 DB/WAL/SHM 的真实拒写、回滚镜像、raw ACK 入口、真实 Consumer ACK 和权限收回。缺失时不允许放行生产发布，状态仍 **NO_GO**。

18:00 晚练承接混合版本、回滚和证据失效的发布阻断，不重复 procfs 基础实验。
