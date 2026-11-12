# Day 83 午练｜SQLite 持久 Trust Watermark 与重启精确重放

日期：2026-11-12（北京时间）｜12:00｜15～25 分钟。

承接早课 `reviewRecoveryWriterTrustBootstrap()` 的纯合同，本节在已有 Node.js / TypeScript Recovery Runtime 中增加一个隔离实验用 SQLite Store：
- `recovery_writer_trust_watermarks` 表保存部署 ID、单调 revision、策略原始字节的 SHA-256；
- 两个 SQLite 连接用 `BEGIN IMMEDIATE` + 同事务条件 UPDATE 完成原子 CAS；
- `bootstrapRecoveredWriterTrust()` 先加载可信锚、从受信 Source 取得策略原始字节并重算摘要、检查部署和 revision，**先用新的 Controller 验证策略格式/时间/Peer**，然后 CAS 更新水位，成功后才返回可供实验使用的 Controller；
- 崩溃后重新构建 Controller 时允许 **同 revision、同 digest** 精确恢复；版本降低、同版换内容、来源缺失或字节损坏一律 hold；不自动填补缺失锚点。

验证：`npm run test:recovery-writer-trust-watermark-sqlite`。仅在一次性 SQLite 数据库上验证；不连接生产 Writer、无真实 TLS Listener 绑定。

**重要局限**：
1. `AuthenticatedRecoveryWriterPolicySource` 是受信边界 **接口**。实验桩手动提供策略；没有实现真实签名、证书吊销或权威策略分发。
2. Store 的 `provisionTrustedAnchor` 仅供明确授权的隔离实验设置初始锚，**绝不能**由外部请求或缺失锚自动触发；真实环境需受信引导与 OS 身份隔离。
3. SHA-256 检查的是 Source 提供的**原始策略字节**；生产需发布方定义稳定规范化格式、验证签名/来源，且只允许受信发布服务写入策略。
4. 同库两个连接可线性化更新；不同机器各自的 SQLite 数据库不构成共享权威。活跃实例之间尚无强制即时失效协议，因此 **不得作为生产热更新/发布依据**。
5. Day 82 `RecoveryWriterMtlsTrustController.install()` 仍禁止同实例重复 revision；这里仅在**冷启动**新实例时通过持久水位匹配接线，不允许用同版本恢复绕过在线单调策略检查。
6. 真实旧 Worker SQLite 目录隔离、旧 FD 清理、真实消费者 ACK、端到端运行仍未完成。**publishAuthorized 恒为 false，生产 NO_GO。**
