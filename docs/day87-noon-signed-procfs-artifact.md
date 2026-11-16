# Day 87 午练｜/proc 原始采集字节 + Ed25519 证明绑定

本练习复用 Day 86 Linux 子进程/SQLite WAL 夹具及 Day 87 早课的签名验证合同。现有 `scripts/day86-noon-host-fd-probe.mjs` 在退出后额外输出一个带前缀的 base64 JSON，其中包括刚才真实从内核读取的 `/proc/<pid>/stat`、各可写 FD 的 `fdinfo` 原文、mount namespace、临时子进程 PID/starttime 与观察时间。保留 Day 86 原有的审查逻辑和日志。

`scripts/day87-noon-signed-host-fd-probe.mjs` 启动 Day 86 实验，只接收一份明确标识的原始证据字节，验证包含可写 SQLite FD 的内核文本，使用**当前实验进程临时生成**的 Ed25519 私钥签名规范化 claims，再通过既有 `reviewSignedWriterCollectorArtifact()` 验证签名、来源预期、release、host、mount namespace、challenge、观测时间与 SHA-256 摘要。

## 本次运行

```bash
npm ci
npm run test:recovery-writer-collector-attestation
npm run test:recovery-writer-host-fd-probe
npm run test:recovery-writer-signed-host-fd-probe
```

用例包含原始字节篡改、错误公钥、伪造签名、不同 release/host/ns/challenge、生产发布意图；所有拒绝均返回 HOLD。最后特意再次提交完全相同的有效签名，验证**在缺少持久 nonce 已消费记录时仍可通过**。这是待 Day 87 晚练修复的重放缺口，不是发布成功。

## 信任边界

本练习只在一次性 Linux /tmp SQLite 子进程上取证，虽真实读取 procfs，但 hostId 和测试公钥都由本地脚本自行提供，不代表受信部署控制面证明。JSON 封装包含内核原文字节，却不包含跨机器认证、TPM、受信采集器安装或对全部旧进程的全局枚举。底层 `/proc` 文件内容在取样时可能变化，这份快照也不是原子 OS 视图。

Day 86 的其余五项发布证据仍为 UNKNOWN，生产旧 Worker/旧 FD、挂载隔离、真实 Consumer ACK 与策略源没有验收，继续 **NO_GO**。绝不提交私钥和生产数据库。
