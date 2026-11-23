# Day 95 早课：Gateway Key Lifecycle & Monotonic Trust Policy

日期：2026-11-24（北京时间）｜Week 14 / Day 95 / 08:00。

承接 [Day 94 联合审查](day94-evening-gateway-release-evidence-boundary.md) 和现有 `Day94GatewayTrustPolicyReader` / `Day94GatewayTrustPolicy`（`src/runtime/recovery-writer-audit-gateway-pinned-watermark.ts`）。该接口只提供单个 pinned key、trustRevision、minimum，尚无密钥生命周期和跨查询撤销语义。

## 设计约束（尚未实现）
- 独立控制面维护 policyEpoch（安全整数，单调增长）、授权 peer、key fingerprint、状态 active/retired/revoked、有效窗及 minimum checkpoint。keyId 仅用于索引，不能作为认证。
- policyEpoch 与 checkpointSequence 是不同的版本域。换钥不得降低审计水位；相同 sequence 的 event hash 不能改变。更高 sequence 必须有独立可信的历史延续证明，不能直接由 Gateway 自己提升。
- 正常轮换可设置有限重叠期；retired 不再接受新的在线应答；revoked 立即禁止在线使用且不能自动复活。历史证据的归档验证与当前在线授权分开处理。
- 请求前读取政策，签名验证后重新读取政策；epoch 或关键政策内容变化则丢弃此次观察结果，重新发起查询。若有最终权限授予，必须在独立控制面以同一政策版本作原子条件授权或 fencing；双读本身不能消灭 TOCTOU。
- 缺政策、过期、撤销、回退、同 epoch 异内容、错误身份、读失败均 HOLD。当前项目不具备生产信任根，所有候选仍 HOLD，publishAuthorized=false。

## 后续实验验收
| 情景 | 预期 |
| --- | --- |
| K1 被撤销后签出新的有效 Ed25519 响应 | 拒绝 |
| 请求使用 epoch 7，响应期间控制面推进 epoch 8 | 丢弃此次结果，重新查询 |
| 换 K2 但 checkpoint 从 2 退回 1 | 拒绝 |
| 同 sequence 不同 eventHash | 拒绝 |
| 新 key 正常、策略一致 | 仅夹具候选通过，仍 HOLD |
| 策略库与网关被同时回滚 | 不宣称检测完备；必须独立防回滚信任域 |

午练计划：在现有 Day 94 verifier 外围添加生命周期检查和前后 policy snapshot 对照实验；晚练计划：与现有 Release Boundary 集成并验证撤销竞态。本文仅架构笔记，不新增运行时 API 或发布权限。
