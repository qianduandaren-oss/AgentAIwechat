# Day 82 早课｜真实传输身份从哪里来：UDS Peer Credentials 与 mTLS

日期：2026-11-11（Asia/Shanghai）；Week 12 / Day 82；08:00。

## 接续 Day 81

Day 81 的 RecoveryWriterRpcCandidateHandler 能严格解析 JSON、拒绝额外 epoch/ownerId/dbPath、做逐操作授权；Admission 层能检查短期重放、ACL 撤销和入场截止时间。但 VerifiedTransportCaller 目前只是测试注入对象，尚无可独立验证的网络身份信任根。今天**只设计可信传输身份与隔离验收边界**，不宣称存在生产 Listener。

## 两种候选信任根

- 同机 UDS：Socket 所在目录和 socket 文件由服务端控制；部署要核验 uid/gid 与真正的 OS peer credentials（Linux 可通过 SO_PEERCRED 等 OS 接口，具体 Node 版本/原生库支持必须实测）。仅凭 socket 路径、进程自报 uid 或客户端 JSON 不可信。
- 远程 mTLS：服务端明确要求客户端证书，校验证书链、有效性/信任锚，再把允许的证书 SAN/身份映射到 subject 和对应的授权策略。客户端请求体里的 X-User-Id、自报证书指纹不能代替握手证据。

两种方式都要阻止反向代理/框架将未经验证的 header 填进 VerifiedTransportCaller。证书轮换、撤销、peer 身份变更须 Fail Closed。

## 与 Day 79–81 现有模块的关系

```text
独立传输身份验证（未来真实适配器）
 → VerifiedTransportCaller（服务端注入，绝不取自 JSON）
 → Day 81 Admission（ACL 再查询/限流/审计）
 → Day 81 RPC Handler（运行时字段白名单）
 → Day 79 SingleWriterCandidateService（可信 Writer Epoch 和 ACK 验证）
 → Day 78 SQLite Epoch+Lease+Version CAS
```

同时必须独立保证：Day 80 的旧 Worker 无 DB 挂载、遗留可写 FD 清空、WAL/SHM 和回滚权限隔离。鉴权不撤销数据库文件权限。

## 今日可执行产物（纯计划审查）

`src/runtime/recovery-writer-transport-trust-review.ts` 的 `reviewRecoveryWriterTransportTrustPlan()` 拒绝未知传输模式、字段缺失或额外字段、任何未声明满足的部署前提。输入全部为未经核验的架构声明；无论结果如何 `publishAuthorized: false`。返回 `ready_for_isolated_transport_probe` 也仅是“可以继续在隔离环境验证真实身份”，**不创建 Socket/TLS 服务、不构造认证用户、不证明 ACL 有效**。

`npm run test:recovery-writer-transport-plan` 只执行纯合同回归；不是端到端安全 CI 证据。

## 今日后续

12:00：选定一类实际可实现的传输，写真实的不可自报 caller 来源和拒绝测试；18:00：复盘证书/peer 凭据更换、凭据验证失败、旧进程访问、混合版本回滚与部署证据。生产仍 NO_GO。
