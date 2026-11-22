# Day 94 早课｜Audit Anchor Gateway 合同：签名有效还不等于来源可信

日期：2026-11-23（北京时间） · Week 14 / Day 94

Day 93 已实现分文件 SQLite 的审计候选与同域双回滚反例。**两个本地数据库及调用方的 pin 同时回滚，查询结果可能仍一致**。本课补的不是第三个版本号，而是受信服务的**请求与响应边界**。

## 信任分层

1. **受信控制面身份**：由独立服务身份、受控 mTLS/IAM 入口、受保护的公钥配置与访问策略建立，不由 `claimedAuthenticated` / `claimedPeerId` 决定。
2. **应答绑定**：每次查询使用本地随机 256-bit challenge，返回必须绑定 deployment/release/attempt、challenge、时间窗、checkpoint sequence、freeze state、manifest digest 与 event hash。
3. **签名核验**：Ed25519 按 v1 稳定字段编码验签；测试中的公钥由调用方注入，只能证明 fixture 对应密钥签署过字节，不代表被授权的生产审计服务。
4. **不可回滚高水位**：即使响应签名正确，也可能来自有签名权的旧镜像，真正的 latest head 必须由独立、单调、不受旧 Worker 回滚的服务端证明；本课尚未实现。
5. **发布授权**：本模块只返回 HOLD、认证锚点数 0 和 `publishAuthorized=false`。不能把 signatureVerified 当作放行条件。

```text
Recovery Runtime (只读审查)
      │ 本地随机 challenge + attempt binding
      ▼
AuditGatewayTransport（当前测试注入，未来受信 mTLS/IAM）
      │ 带 checkpoint + sequence + eventHash 的签名响应
      ▼
校验域/版本 → scope → nonce → time → Ed25519
      │
      ├─ 任一失败 → HOLD（明确 reason）
      └─ 夹具签名正确 → HOLD（上游信任与 latest 未证明）
```

## 今日接口

- `src/runtime/recovery-writer-audit-gateway-contract.ts`：`Day94AuditGatewayTransport`、`Day94AuditGatewayRequest`、`Day94AuditGatewayPayload`、`encodeDay94GatewayPayload()`、`reviewDay94AuditGatewayCandidate()`。
- `src/demos/day94-morning-audit-gateway-contract-test.ts`：使用进程内临时 Ed25519 密钥对（不落盘、不提交），覆盖空响应、断连、错绑、旧响应重放、过期、伪造声明、错钥签名与禁止生产发布。
- 运行：`npm run test:recovery-writer-audit-gateway-contract`。

## 不能误判的地方

- **公钥 pin 的来源未认证**：实验输入可被攻击者替换，故签名成功只代表相对该 pin 的字节一致性。
- **随机 nonce ≠ 持久一次性消费**：它约束单次响应的请求绑定，不证明跨进程、跨崩溃的历史单调或最新头。
- **当前尚未连接 Day 93 的实际 Gate**：今日是 Gateway 证据合同和签名校验，不是完整发布准入。
- **安全边界仍缺**：受信部署全集、真实独立 Host 观察、旧 FD/回滚写隔离、Consumer ACK、控制面不可回滚审计和可信密钥配置。生产 NO_GO。

12:00 将设计受信 Gateway Adapter 的服务端身份注入与单调水位钉住（仍只用隔离夹具），18:00 联合演练失败关闭。
