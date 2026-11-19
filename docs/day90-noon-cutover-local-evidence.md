# Day 90 午练｜真实 Linux 局部证据进入双时点覆盖矩阵，但不能升级 PASS

2026-11-19（北京时间）｜Week 13 / Day 90｜12:00｜20–25 分钟

## 先明确证据边界

Day 90 早课固定主机/namespace 的两阶段七项检查。Day 86 Linux /proc 实验抓到的是**自建临时 SQLite 子进程的真实 FD 原文**，并非整台生产主机旧 Writer 清场。Day 89 Linux DAC 实验测试的是**一次性目录中不同 UID 的新 open() 拒写**，不能推断旧 FD、生产挂载、回滚或 ACK。

本练习将这两种局部事实纳入 Day 90 编排，却故意保持覆盖矩阵的所有单元为 UNKNOWN，不把负向测试 PASS 冒充部署安全证明。

## 本次工程改动

- src/runtime/recovery-writer-cutover-local-evidence.ts：将 day86_owned_child_writable_sqlite_fd 仅关联到 legacy_writable_fds_drained 项，将 day89_disposable_uid_new_open_denial 仅关联到 legacy_db_wal_shm_denied 项。只标识相关夹具信号；28 个单元全部保留 UNKNOWN。
- src/demos/day90-noon-cutover-local-evidence-test.ts：测试 28 个 UNKNOWN、另一主机和 cutover 无相关证据、错误 host/ns、重复/过期/非法摘要阻断，及伪造摘要不能升级为 PASS。
- scripts/day90-noon-cutover-local-probe.mjs：启动 Day 86 真实 /proc 实验，严格解析原始 base64 记录、验证 fdinfo 八进制可写 flags。设置 DAY90_ENABLE_DAC_LAB=1 后，还启动 Day 89 的实际 sudo/setpriv Linux 双 UID 测试，核实 DB/WAL/SHM 与目录共四项拒写，任何失败直接停止。
- package.json、README.md、.github/workflows/runtime-tests.yml：加入编译、测试与一次性 Linux CI 实验。

内部调用 Day 90 早课的 reviewWriterCutoverEvidenceCoverage 时始终传入 receipts: []，绝不会构造独立采集者 PASS 收据。host 和 namespace 仍来自本地实验运行器而非可信发布平台；即使同一主机的两种实验信号都齐全，也没有实际 cutover 时点或第二台主机的任何证明。

## 执行

仅在一次性 Linux / CI 中运行：

~~~bash
npm ci
npm run test:recovery-writer-cutover-local-evidence
~~~

如果要运行额外的 Day 89 双 UID 实验，须确保 CI/VM 提供 Node 22、sudo -n、setpriv，不要在生产机执行：

~~~bash
DAY90_ENABLE_DAC_LAB=1 npm run test:recovery-writer-cutover-local-evidence
~~~

普通运行只实际采集 Day 86；环境不支持第二项时没有隐含的 Day 89 成功记录。CI 显式要求第二项必须成功。

## 验收

- 所有 28 个覆盖单元 status=unknown，acceptedHostReceiptCount=0，publishAuthorized=false。
- 真实 Day 86 原始记录中出现 /agent.sqlite 的可写 fdinfo，摘要由实际原始字节计算。
- 可选 Day 89 输出必须真实满足 Controller UID=65021、Worker UID=65022、DB/WAL/SHM/目录四项拒写。
- 未观察的 host、cutover 时点、完整进程清单、旧 FD、回滚、挂载、外部审计和 Consumer ACK 均保持未验证。

**生产 NO_GO**。18:00 晚练将把未覆盖主机、旧 FD、回滚恢复和无效签名收据列入发布阻断条件。
