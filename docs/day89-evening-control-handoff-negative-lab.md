# Day 89 晚练｜旧 FD 仍能写与危险回滚恢复写权限

日期：2026-11-18｜Week 13 / Day 89｜18:00｜隔离 Linux 负向验收

## 目的与连续性

Day 89 早课静态审计仍发现遗留管理方法公开；午练以不同 Linux UID 验证了新打开 DB/WAL/SHM 和目录写入被拒绝。本次主动制造两类此前尚未证明已清除的情况：

1. Worker 在权限收紧之前打开的可写 FD，随后即便新打开被拒绝，仍能够写入。
2. 危险回滚把数据库及 WAL/SHM 文件与目录恢复为 Worker 可写后，新 Worker 重新取得写能力。

这是对部署切换风险的**反例演练**，不是漏洞修补或生产发布许可。

## 实验流程

- 全程在唯一的 /tmp/agent-day89-evening-* 目录，不读取生产数据库或密钥。
- root 仅负责编排与权限切换。控制面 UID=65021 维持一个真实的 SQLite WAL 数据库连接；Worker UID=65022 不持有控制面数据库服务实例。
- 创建另一份**专门用于破坏性验证、已关闭 SQLite 连接的快照** legacy-control-snapshot.sqlite。旧 Worker 在权限开放前以 O_RDWR 打开该快照并保存 FD；由旧 Worker 自行读取 /proc/self/fdinfo 确认可写标志。
- 将快照、主数据库、WAL、SHM 收紧为 0600，目录设为 0711；新 Worker 的 DB/WAL/SHM O_RDWR 和目录创建四项操作必须返回 EACCES。
- 旧 Worker 在**原先打开的 FD 上**对仅供实验的快照写入一个字节并 fsync；确认即便新打开已拒绝，旧 FD 仍然能写。这会故意损坏快照头部；不会写坏正在使用的主 WAL 数据库。
- 模拟**危险**回滚：把主数据库、WAL、SHM 改成 0666、目录改成 0777；新 Worker 四项打开/创建全部成功。恢复 0600/0711 后，四项再次返回 EACCES。
- 进程退出并删除一次性目录。任何断言不匹配、环境权限不足、异常错误码，整个实验失败。

## 运行

**仅在 disposable Linux CI/VM 使用**：

    npm ci
    npm run test:recovery-writer-legacy-control-surface
    npm run test:recovery-writer-control-os-isolation
    npm run test:recovery-writer-control-handoff-negative

需要 Node.js 22+、非交互 sudo、setpriv 和容许测试 UID 的 Linux 环境。不是生产 root 操作手册。输出 isolated_unsafe_handoff_counterexamples_observed 及四项布尔值（旧 FD 可写、新打开受拒、回滚恢复新开权限、再次锁定受拒），固定 publishAuthorized: false。

## 本轮发现并修复的旧课程缺口

Day 89 午练原始 Actions #44234964587 实际为 failure：切换到测试 UID 后无法访问 GitHub checkout 中的脚本，出现 MODULE_NOT_FOUND，不能据此断言 SQLite DAC 通过。现已修改午练脚本，在 root 的一次性 /tmp 目录复制只读脚本供两个低权限子进程执行；保留权限验证逻辑。新 CI 必须再次确认。

## 发布阻断清单

- 旧 Worker PID/starttime、所有相关 FD 的独立采集和回收未完成；
- 真实控制面的 DB/WAL/SHM、目录、容器 mount namespace 和文件身份未完成独立拒写验证；
- 混合版本与回滚必须保证旧数据库写挂载、旧镜像、原始 ACK 和无水位构造不会复活；
- 真实 mTLS 控制面认证、公钥管理隔离、外部不可篡改审计锚点和 Consumer ACK 尚未联调；
- 本实验旧 FD 来自一次性快照，**未证明活跃 SQLite WAL 的旧 FD 写操作和全局关闭**。快照中的自采 /proc/self 信息不是受信主机采集证明。

所有候选部署仍 **NO_GO**；即使 CI 绿灯，只能说明负向实验成功复现风险。

## 下一步

Day 90 将转向**发布切换的进程清场与证据编排**：由独立观察者列出旧进程/FD、容器命名空间和版本水位；先关闭旧写者并检查不再持有可写 FD，然后重新验收回滚拒绝。不得把本次负向测试通过写成生产已具备切换条件。
