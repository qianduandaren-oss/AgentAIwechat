# Day 82 晚练｜mTLS 证书轮换、旧连接撤权与回滚边界

日期：2026-11-11（北京时间）｜Week 12 / Day 82｜18:00｜20～30 分钟。

## 与早午课程衔接

08:00：确定可信 Caller 身份必须来自 UDS peer credentials 或真实 mTLS 证书，不允许来自 JSON/Header。
12:00：完成真实 Node TLS 1.3 双向握手与服务端 SHA-256 指纹白名单映射，委派给 Day 81 Admission / Handler；合法 ACK 仍用实验 Stub。
18:00：补证书轮换/撤权后旧连接、信任快照过期、部署绑定、单调版本及回滚拒绝；不能把 TLS 握手成功等同于终生有效授权。

## 当前工程改动

- 新增 src/runtime/recovery-writer-mtls-trust-controller.ts。只接收受信服务端注入的部署快照。快照包括 deploymentId、单调 revision、issuedAtEpochMs、expiresAtEpochMs 和 peers；过期、时钟回退、错误部署、重复指纹、旧版本以及任何非法更新 fail-closed。注意：本实现的版本水位仅进程内；重启须注入来自持久受信源的 minimumRevision。
- 修改 src/runtime/recovery-writer-mtls-transport.ts：允许与旧静态 peers **互斥**的 trustController；TLS 握手验证后映射身份，接收报文后在调用 Day 81 Handler 之前再次核验当前指纹、subject 和操作权限，旧连接撤权被拒绝。
- 增加 src/demos/day82-evening-mtls-trust-rotation-test.ts，以及扩展 scripts/day82-noon-mtls-peer-lab.mjs 进行真实 TLS 连接及撤权测试；更新 npm 脚本与 CI。

## 实验命令

~~~bash
npm ci
npm run test:recovery-writer-mtls-rotation
~~~

## 审查 Checkpoint

1. **真实 TLS 握手前**：TLS 1.3 必须要求并验证客户端证书；合法证书未进入受信服务端指纹映射则拒绝。
2. **握手后、派发前**：证书可能被从服务端快照撤销；旧连接也必须重新映射。重新映射的结果不允许静默改变已经建立连接的主体/权限。
3. **授权撤销**：Day 81 Admission 再读服务端 ACL；通信身份撤销和操作授权撤销不是同一件事。
4. **信任快照失效**：部署不匹配、回滚旧版本、时钟失败、过期、错误格式必须 hold，并清空此前允许状态。
5. **审计**：仅记录关联标识、受信 subject、操作与决定；不写入原始 ACK、leaseToken、私钥或证书内容。
6. **旧镜像回滚**：即便证书轮换正确，旧 Worker 直写 SQLite 与遗留 FD 仍必须通过 Day 80 独立部署拒绝测试。

## 局限 / 发布状态

该控制器是 **in-memory lab**：快照由示例可信函数注入，没有外部签名/可信发布渠道；revision 水位重启后不会自动持久化；TLS Listener 没有完整生产运维/证书撤销分发；从校验到 SQLite 事务仍存在竞态。不能靠它证明 CA 轮换、证书吊销最终一致性、生产网络安全与自动发布权限。

真实消费者签名 ACK、生产 Writer 独立 OS 身份与 DB 挂载隔离、遗留 FD 清理、混合版本回滚验收、持久防重、可靠审计均待完成。**生产 NO_GO**。

Day 83 继续验证真实可信策略分发、版本水位持久化及策略更新时的 Fail-Closed 行为，不重复已完成的本地 TLS 握手。
