# Day 88 晚练：管理权限旁路、审计篡改与撤销先后顺序

日期：2026-11-17（Asia/Shanghai）。承接早课 `reviewCollectorControlPlaneCommand()` 和午练 `IsolatedCollectorControlPlaneService`、`executeAuditedControlCommand()`。

## 为什么要做反例

Day 88 午练保证：经过服务的管理调用，身份/ACL 复核、Challenge 操作和持久审计放在同一 SQLite 写事务内。但 Day 87 旧管理方法仍公开，同一数据库目录也可能被旧 Writer 直接写。新的安全入口并不会自动关闭这些旁路。

### 负向实验

```bash
npm ci
npm run test:recovery-writer-control-plane-service
npm run test:recovery-writer-control-plane-boundary
```

1. **审计锚点**：新 `captureControlAuditSnapshotForLab()` 把指定 release 的完整审计行、deployment 下 key 状态及该 release 的 challenges 规范化为摘要。将摘要临时保留在 SQLite 外的测试变量，再调用 `reviewControlAuditSnapshotForLab()`；缺锚点即 HOLD，直接 SQL 改审计行后返回 `external_audit_anchor_mismatch`。
2. **旧管理方法旁路**：模拟 runtime_worker 通过新服务请求签发被拒绝；随后由另一个可写 SQLite Store 实例调用旧 `issueChallenge()`，可以成功签发但不产生审计。比对关系返回 `unaudited_challenge`。旧 `provisionLabTrustedKey()` 还可以创建无审计公钥，返回 `unaudited_key`。这是**证明漏洞仍然存在的预期 PASS**，不是修好了旁路。
3. **撤销与消费先后**：两个 SQLite 连接上测试撤销先于消费（HOLD），以及消费先于撤销（首次隔离候选通过、重放 HOLD）；这些是可控串行顺序，不是跨线程压力竞争，更不是独立 OS 主机真实隔离。
4. **混合版本风险**：旧 Worker 只要保有文件或 WAL/SHM 写能力，仍可绕开新服务的授权检查和任何应用内审计。Day 80/85 的旧 FD 与回滚实验继续作为独立否定证据。

### 严格限制

本模块没有生产级鉴权、mTLS 证书链、OS 权限、mount namespace 观测或防篡改审计服务。所谓 “externallyPinnedSha256” 在测试中只是一份进程内变量；真实发布必须由独立且受信的控制面持久保管、认证和复查锚点。校验器只检查自身查询到的相同 release 范围记录，不提供跨 release 的完备性证明。数据库拥有写权限者可能同时改写 key、challenge、audit，并制造一个新的匹配摘要；没有受信外部锚点就无法阻挡。

**不能把 `ready_for_isolated_audit_rehearsal` 理解为生产放行：始终 `publishAuthorized=false`，生产 NO_GO。**

## Day 89 下一步

把仅用于隔离实验的管理员 API 与业务 Worker 进程拆开：分离控制面与数据面 OS 用户、DB/WAL/SHM 权限及挂载；再验证真实 mTLS 入口、旧 FD 排空与独立审计锚点。先消除旁路，不再靠越来越多的自报 JSON 判断发布就绪。
