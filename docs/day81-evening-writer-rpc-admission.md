# Day 81 晚练｜RPC Admission：重放、并发、撤权与审计

日期：2026-11-10（北京时间）｜Week 12 / Day 81

## 从当天早、中、晚连续推进

- 早课：客户端只传业务意图；身份从可信传输上下文获取，Writer Epoch 从受信协调器获取。
- 午练：`RecoveryWriterRpcCandidateHandler` 对原始 JSON 做 16 KiB 限制、精确字段白名单、按操作授权，接入 Day 79 候选服务。
- 晚练：`RecoveryWriterRpcAdmissionHandler` 包裹午练 Handler，增加进程内请求重放窗口、每主体并发限制、服务端异步撤权复查、派发前审计和超时/取消入场门禁。

## 语义边界

1. 同主体、同 requestId 在有效重放窗口拒绝；这是**进程内限流辅助**，并非跨进程持久化幂等。真正投递幂等仍依赖稳定 eventId + Consumer Inbox。
2. 服务端控制 admission deadline，且仅在委派底层服务前生效。取消发生于委派之后，不能保证事务、外部副作用已经回滚；需要按 eventId 查询持久状态。
3. `reauthorize()` 是受信授权源的候选接口，必须服务端独立读取最新授权，不从请求体/Header 读取。它无法证明真实 transport 身份，也不能关闭授权检查后到事务提交前的全部 TOCTOU。
4. `recordAudit()` 在派发前同步成功才允许操作；日志只包含 requestId、subject、operation、decision。后续应建立持久审计与结果关联，审计输出中不得包含 leaseToken 或原始消费者 ACK。
5. 入口控制状态在进程重启后丢失，不可把它当成 durable request ledger。全量生产安全状态仍 **NO_GO**。

## 运行

```bash
npm ci
npm run test:recovery-writer-rpc
npm run test:recovery-writer-rpc-admission
```

覆盖过期入场、预派发取消、ACL 撤销、审计故障 Fail-Closed、同请求重放、并发过载、合法确认、敏感信息不入审计、重启丢失防重状态及窗口过期。

## 发布阻断

本次仅实现进程内候选安全门禁与单元回归；没有真实 Unix Socket peer credentials 或 mTLS、生产 OS SQLite 目录隔离、真实消费者签名验证、持久化跨副本重放机制、生产审计和切换回滚证明。继续 **NO_GO**。

Day 82 主线：真实传输适配器的信任根与服务账户权限，围绕 UDS peer credential / mTLS 做选择与强制启动检查；不要把今天的 fake caller 当成已经认证。
