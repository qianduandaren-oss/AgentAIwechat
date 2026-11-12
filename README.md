# Agent AI 工程师 · Day 1–83 TypeScript 实战项目

这是 Agent AI 工程师学习过程里的持续演进代码仓库。

项目不是每天新建一个孤立 Demo，而是围绕同一套 TypeScript Agent Runtime 不断往生产级方向补能力：从最早的 LLM 调用、Tool Calling、Planner、Multi-Agent，到后面的 Evaluation、Tracing、Budget、安全、可靠性、优雅停机、Cancellation，以及现在的 Durable Execution / Recovery。

当前课程进度：**Day 83 早课**（2026-11-12）。当前 Recovery 仍是候选架构，正式发布 NO_GO。

## Week 12 / Day 83 早课：持久策略水位与可信重启合同

- [早课：可信策略版本水位和重启原子性](docs/day83-morning-trust-policy-watermark.md)。新增 `src/runtime/recovery-writer-trust-watermark-contract.ts`：持久 `deploymentId / revision / policySha256` 检查点接口、CAS 接口、受信策略来源接口与只读引导审查。
- `npm run test:recovery-writer-trust-watermark-contract`：覆盖持久锚缺失、降级、同版本换内容、同版本相同摘要重启候选、部署错绑和不可信来源。纯合同；不执行真实持久化或密码学认证。
- Day 82 控制器仍**只有进程内 revision**且 `install()` 不支持相同 revision + digest 的精确重放；这是今天午练的接线待办。生产 **NO_GO**。

## Week 12 / Day 82 晚练：证书轮换、旧连接撤权与回滚拒绝

- [晚练：证书生命周期及真实 TLS 连接负向验收](docs/day82-evening-mtls-rotation.md)；新增 `RecoveryWriterMtlsTrustController`，使用服务端版本化快照管理证书指纹，过期/撤权/错误部署/时钟回退/版本倒退一律关闭身份映射。
- Day 82 的真实 mTLS Listener 增加派发前再查当前指纹映射：TLS 握手后撤销证书，旧连接不能在后续报文中复用身份。旧测试仍支持静态 `peers`，动态源 `trustController` 不允许与其混用。
- `npm run test:recovery-writer-mtls-rotation`：策略/过期/回滚/恢复水位 + 本机真实 TLS 证书切换、旧连接拒绝与审计脱敏。仅实验环境；快照信任源、持久水位、运行时密钥轮换、生产 DB 隔离、真实消费者 ACK 仍未实现，发布 **NO_GO**。

## Week 12 / Day 82 午练：真实 localhost mTLS 证书身份映射

- [午练：受信证书 → VerifiedTransportCaller → Day 81 Admission + Handler](docs/day82-noon-mtls-peer-binding.md)；新增 `src/runtime/recovery-writer-mtls-transport.ts`，通过 Node 标准 TLS Server 强制验证客户端证书，使用服务端配置的 SHA-256 指纹白名单绑定 subject/操作权限。
- `npm run test:recovery-writer-mtls-peer`：OpenSSL 临时证书、真实本机 TLS 握手、无证书/未注册证书拒绝、JSON 伪造字段、操作无权限、ACL 撤销和模拟 ACK。
- 本实验有真实 mTLS 握手，但仍无真实消费者 ACK、生产 OS DB 挂载隔离、证书生命周期及跨进程幂等。发布 **NO_GO**。

## Week 12 / Day 82 早课：可信传输身份的信任根（UDS / mTLS）

- [早课：UDS Peer Credentials / mTLS 的信任根与部署约束](docs/day82-morning-transport-trust-root.md)。沿用 Day 81 的 Candidate Handler / Admission，不让客户端 JSON、任意 Header 或 TypeScript 类型冒充真正的已认证身份。
- 新增 `src/runtime/recovery-writer-transport-trust-review.ts` 和 `npm run test:recovery-writer-transport-plan`：审查候选部署方案，模式不支持、前提缺失或额外字段则 hold；即使全部声明满足也只返回 `ready_for_isolated_transport_probe`，`publishAuthorized=false`。
- **这是未经核实部署声明的纯策略校验**，没有实际 UDS peer credential 读取、mTLS 握手、RPC Listener 或生产文件权限/ACK 验证。生产仍为 **NO_GO**。

## Week 12 / Day 81 晚练：RPC Admission 的重放、撤权与审计边界

- [晚练：候选 RPC Admission、失败与取消检查](docs/day81-evening-writer-rpc-admission.md)；新增 `RecoveryWriterRpcAdmissionHandler`，复用午练 `RecoveryWriterRpcCandidateHandler`，在进程内加入主体并发上限、短期 requestId 重放窗口、服务端 ACL 撤权复查、派发前审计、取消/截止时间入场门禁。
- `npm run test:recovery-writer-rpc-admission`：覆盖重复请求/并发、ACL 撤销、审计不可用、预派发取消、ACK 审计脱敏与重启后窗口丢失，另保留原 Day 81 午练 SQLite 集成回归。
- **重要边界**：requestId 不是 durable 幂等键；派发后取消不撤销副作用；尚无真实身份认证、生产 OS 隔离、持久审计、真正消费者 ACK，因此 **NO_GO**。

## Week 12 / Day 81 午练：运行时 RPC JSON 白名单与逐操作授权

- [午练：候选 RPC Handler、严格请求解析与授权](docs/day81-noon-writer-rpc-handler.md)。新增 `src/runtime/recovery-writer-rpc-handler.ts`：只接受最大 16 KiB 的原始 JSON 字符串，按操作严格校验顶层字段，禁止客户端提交 `epoch`、`ownerId`、`dbPath` 与身份；未认证调用、无权限操作全部 hold。
- `npm run test:recovery-writer-rpc` 使用同一套 Day 79 Candidate Service + Day 78 SQLite Fencing，验证未知操作、非法请求、权限拒绝、伪造 ACK 不更新 Outbox，以及可信模拟 ACK 后的事务确认。
- **依然是进程内候选层**；未实现真实网络监听、peer identity/mTLS、请求重放/限流/审计、生产 OS 隔离与真实消费者密码学验证。**生产 NO_GO**。

## Week 12 / Day 81 早课：受信 IPC/RPC 业务请求合同

- [早课：通信身份与 Writer Epoch 的分离](docs/day81-morning-recovery-writer-ipc-boundary.md)；新增 `src/runtime/recovery-writer-rpc-contract.ts`：明确客户端只携带业务意图，服务端独立验证调用身份并内部获取 Epoch/时钟/ACK 校验器。
- **仅接口和架构合同**，未实现 IPC Listener、运行时 JSON 白名单校验或真实认证；Day 80 OS 权限隔离仍未部署验收，生产 **NO_GO**。

## Week 12 / Day 80 晚练：旧 FD、混合版本与回滚拒绝验证

- [晚练实验与发布检查](docs/day80-evening-writer-handoff.md)：在午练 Linux DAC 探针基础上，新增一次性旧可写 FD 反例；新身份文件/目录打开被拒绝时，旧进程原先已打开的 FD 仍能写入。
- `npm run test:recovery-writer-handoff`：任一旧进程存活、FD 未关闭、混合镜像直写、回滚挂载恢复或 raw ACK 旁路清单不合格则 `hold`。审查只处理未经核实的候选声明，**不授权 publish**。
- `npm run test:recovery-writer-stale-fd-lab`：在 Linux 一次性 /tmp 普通文件上，用 `nobody` 身份验证旧 FD 可写与新打开被拒绝。需无交互 sudo；无条件执行不了则失败，不伪装 PASS。
- **生产 NO_GO**：真实 SQLite/WAL/SHM 访问、旧进程/FD 清理、混合版本和回滚拒绝、RPC/ACK 认证尚未在部署环境独立验收。

## Week 12 / Day 80 午练：一次性 SQLite 目录 Linux DAC 拒绝探针

- [午练实验说明](docs/day80-noon-writer-isolation-lab.md)；新增 `reviewSqliteWriterIsolationPlan()` 纯策略，危险身份/挂载/回滚计划直接 hold，不能授权生产。
- `npm run test:recovery-writer-isolation-policy`：拓扑声明负向测试；`npm run test:recovery-writer-isolation-lab`：仅 Linux 隔离 CI，以同 UID 正控和 nobody 负控对一次性 /tmp SQLite 数据做真实 OS 拒绝探针。环境不满足时失败，不伪装 PASS。
- **不是生产部署的单 Writer 隔离证据**；旧 FD、挂载/容器特权、WAL/SHM、真实 ACK 和回滚仍未验收；生产 **NO_GO**。

## Week 12 / Day 80 早课：SQLite Writer OS 身份与挂载隔离

- [早课：部署隔离威胁模型与负向探针设计](docs/day80-morning-sqlite-writer-isolation.md)；在 Day 79 候选 Service/发布证据审查基础上，明确不同 OS 身份、数据库目录不挂载、WAL/SHM、旧 FD、混合版本与回滚的验收要求。
- 仅更新架构文档，**没有**部署真实 Writer 服务，也没有执行 OS 探针；旧 SQLite 写权限仍未真正收回，生产 **NO_GO**。

## Week 12 / Day 79 晚练：发布证据、回滚与旧 SQL 旁路

- [晚练审查](docs/day79-evening-single-writer-release-gate.md)；新增 `reviewSingleWriterReleaseEvidence()`，九类证据缺失/过期/失败时 fail closed，即使全部通过也只能进入外部人工安全审查（`publishAuthorized=false`）。
- `npm run test:recovery-single-writer-release`：校验九类证据、回滚混合版本拒绝、真实 SQLite 直接 SQL 仍能绕过候选 Gate。
- 发现 CI 工作流的 Day 75 noon 测试被放在 checkout 前，已修正测试顺序并补 Day 75–79 回归。独立真实部署的 OS 写权限拒绝/真实 ACK 尚待验收，生产 **NO_GO**。

## Week 12 / Day 79 午练：Fail-Closed 单一写入候选服务

- [午练说明](docs/day79-noon-single-writer-candidate.md)：实现 `RecoverySingleWriterCandidateService`，复用 Day 76 Cutover evidence、Day 75 ACK binding、Day 78 同事务 Epoch + Lease + CAS。
- `npm run test:recovery-single-writer-candidate`：启动拒绝、控制器离线、认证失效、认证中部署变化、旧 Epoch 拒绝、新 Worker 接管等候选回归。
- **不是 RPC 或真实安全门禁**；模拟验收不撤销旧进程 OS 写权限；生产 **NO_GO**。

## Week 12 / Day 79 早课：单一写入服务的强制边界

- [早课架构与旧 SQL 旁路审计](docs/day79-morning-single-writer-authority.md)；新增 `src/runtime/recovery-single-writer-service-contract.ts` 的**类型契约**，不提供生产服务或安全授权。
- 下一步需从 OS/部署层撤销旧进程 SQLite 写权限，服务端验证真实 ACK，再联通现有 Epoch + Lease + CAS。旧 Dispatcher、raw ACK 与 SQL 直写仍未隔离，正式发布 **NO_GO**。

## Week 12 / Day 78 晚练：Fencing 边界与直接 SQL 旁路

- [晚练审查](docs/day78-evening-fenced-outbox-boundary.md)；运行 `npm run test:recovery-fenced-outbox-evening`。验证旧 Epoch/旧 Lease 拒绝，同时刻意复现直接 SQL 绕过。生产 NO_GO。

## Week 12 / Day 78 午练：Epoch + Outbox 同事务候选

- [午练实现说明](docs/day78-noon-fenced-outbox.md)；新增 `SQLiteFencedOutboxDelivery` 与 `npm run test:recovery-fenced-outbox`。旧写入旁路未隔离、真实 ACK 认证未实现，NO_GO。

## Week 12 / Day 78 早课：Writer Epoch 与 Outbox 联合事务设计

- [早课架构笔记](docs/day78-morning-outbox-epoch-transaction.md)：审计现有 Epoch Store 与 Outbox Claimer 的分离边界，明确同库、同事务校验 Epoch + Lease + Version CAS。尚未接线，生产 NO_GO。

## Week 11 / Day 77 晚练：旧代次重启与直接 SQL 旁路

- [晚练笔记](docs/day77-evening-writer-epoch-bypass.md) · [Week 11 Checkpoint](docs/checkpoints/week11-day77.md)
- `npm run test:recovery-writer-epoch-evening`：验证旧 Epoch 被拒绝、重启后持久化，并刻意证明直接 SQL 可以绕过候选 Fencing；生产 NO_GO。

## Week 11 / Day 77 午练：SQLite Writer Epoch 候选实现

- [午练笔记](docs/day77-noon-writer-epoch.md)；新增 `SQLiteWriterEpochStore` 与 `npm run test:recovery-writer-epoch`，验证同事务栅栏与旧 Worker 拒绝。尚未接入生产 claim/ack，NO_GO。

## Week 11 / Day 77 早课：Writer Epoch / Fencing Token

- [早课笔记](docs/day77-morning-writer-epoch-fencing.md)：讲解持久化单调 Epoch、同事务写入栅栏与旧 Worker 复活；仅架构设计，尚未实现强制 Fencing，NO_GO。

## Week 11 / Day 76 晚练：Cutover TOCTOU 回归

- [晚练笔记](docs/day76-evening-cutover-toctou.md)；新增 `CutoverEvidenceGuard` 和 `npm run test:recovery-cutover-recheck`。检查时旧 Worker 复活会 hold，但尚无数据库级持续 fencing，NO_GO。

## Week 11 / Day 76 午练：可信启动门禁（候选）

- [午练笔记](docs/day76-noon-cutover-bootstrap.md)；新增可信证据采集入口和 fail-closed bootstrap；8 项回归。仍未封闭旧写入口，NO_GO。

## Week 11 / Day 76 早课：Dispatcher Cutover 启动门禁

- [早课笔记](docs/day76-morning-dispatcher-cutover-gate.md)；新增 `reviewDispatcherCutover()` 纯策略合同，明确六项可信启动前提；返回结果不授权 publish。
- 旧 Dispatcher 和 raw ACK 尚未隔离，生产 NO_GO。

## Week 11 / Day 75 晚练：候选 ACK Gateway 与 Cutover 门禁

- [晚练笔记](docs/day75-evening-dispatcher-cutover.md)；新增 `RecoveryVerifiedDeliveryGateway` 与 `npm run test:recovery-dispatcher-cutover`，组合现有 SQLite claim、可信 Adapter 合同及租约 CAS。
- 旧内存 Dispatcher、直接 acknowledge 旁路仍未封闭，真实认证未接入，**NO_GO**。

## Week 11 / Day 75 午练：ACK Adapter 候选接线

- [午练架构笔记](docs/day75-noon-authenticated-ack-adapter.md)；新增 `acknowledgeVerifiedConsumerDelivery()`，先校验受信 Adapter 返回的消费者证据，再执行 SQLite 当前租约 CAS。
- `npm run test:recovery-authenticated-ack`：7 项候选测试。真实认证与旧 Dispatcher 旁路隔离未完成，NO_GO。

## Week 11 / Day 75 早课：可信消费者 ACK 与单一 Dispatcher 入口

- [架构笔记](docs/day75-morning-authenticated-ack-cutover.md) 与 `src/runtime/recovery-outbox-ack-boundary.ts`：纯 ACK 身份绑定审查，不授予认证权限；旧 Dispatcher 旁路仍待封闭。生产 NO_GO。

## Week 11 / Day 74 晚练：消费者 Inbox 去重与 ACK 丢失

- [晚练：消费者 Inbox 原子去重与故障注入](docs/day74-evening-outbox-consumer-dedupe.md)；[午练：SQLite Delivery Lease](docs/day74-noon-outbox-delivery-lease.md)。
- 新增 `SQLiteRecoveryOutboxConsumerInbox`：使用与生产者独立的 SQLite 文件，在消费者事务中一起保存 Inbox eventId 与模拟业务效果；ACK 丢失重投只返回稳定重放证据。
- `npm run test:recovery-outbox-consumer-dedupe`：12 个独立 SQLite 场景；生产者旧 Dispatcher 旁路、真实 ACK 认证、网络 Publisher、真实业务幂等和跨进程验收仍缺失。**NO_GO**。

## Week 11 / Day 74 早课：Outbox Delivery Idempotency

- [早课：投递 ACK 歧义与消费者去重](docs/day74-morning-outbox-delivery-idempotency.md) 在 Day 73 的同库唯一 Outbox 事件之上区分「一次入库」和「至少一次投递」。
- `src/runtime/recovery-outbox-delivery-contract.ts` 增加纯 `planRecoveryOutboxDelivery()`，复用现有 Outbox 记录；`npm run test:recovery-outbox-delivery-contract` 验证合同。
- 当前 Dispatcher 尚无持久化 claim/lease；消费者去重与可信 ACK 尚未实接，不能宣称 exactly-once。正式发布 **NO_GO**。

## Week 11 / Day 73：远程收据消费与终态 CAS

- [晚练：双 Finalizer 隔离与重放完整性](docs/day73-evening-receipt-finalizer-boundary.md)；[午练：SQLite 原子收据消费](docs/day73-noon-receipt-consumption-sqlite.md)；[早课：消费 CAS 合同](docs/day73-morning-receipt-consumption-cas.md)。
- 现有候选 Finalizer 同库提交 Consumption、Control、Command、Effect、Outbox，并阻止通用 Finalizer 对 Effect-backed Command 绕过消费；真实生产入口尚未完成。



## Week 11 / Day 72 晚练：收据已入库，但终态仍要重新授权和 CAS

- [晚练：可信收据 → 终态事务候选](docs/day72-evening-remote-receipt-terminal-handoff.md) 增加同库 read-only 检查：远程收据、UNKNOWN/Epoch、Command executing v2、当前 Run/Grant/ACL、Control CAS 和 Provider 一致性。
- `npm run test:recovery-remote-receipt-terminal-review`：15 个 SQLite 场景覆盖撤权、权限版本漂移、Control 已变化、Provider 事故、错绑收据、双读者。仅返回事务候选，不写终态。
- **明确没有**实现收据消费与 Command/Control/Outbox 同事务 Finalizer；Provider Registry 不受 SQLite 锁控制。正式发布 **NO_GO**。

## Week 11 / Day 72 午练：可信远程收据持久化

- [午练：远程 applied 收据同库唯一约束与授权](docs/day72-noon-remote-receipt-persistence.md) 在已有 Effect Ledger 增加不可变收据表，阻止同收据串用和本地模拟 Sink 误覆盖远程证据。
- `npm run test:recovery-remote-receipt-persistence`：17 项同库候选回归。收据持久化后 Effect 仍 UNKNOWN、Command 仍 executing v2。

## Week 11 / Day 72 早课：可信远程收据审查，不等于成功终态

- [收据身份与存储边界](docs/day72-morning-trusted-remote-receipts.md)：延续 Day 70 UNKNOWN Reconciliation 和 Day 71 Provider Conformance，增加只读的 applied receipt 身份、Epoch、配置版本和时效校验。
- `npm run test:recovery-remote-receipt-review`：25 项合同回归；结果只能是「待事务性持久化收据」或人工核对，不执行远端工具、不修改 Ledger/Command、不直接标记 terminal。
- 可信 Provider Adapter 尚未实现；真实生产接线、权限与 Legacy 旁路隔离仍待完成，发布 NO_GO。

## Week 11 / Day 71 晚练：供应商能力漂移与发布门禁

- [晚练实现与发布阻塞清单](docs/day71-evening-provider-conformance-release-gate.md) 在午练候选矩阵上增加服务端探针证据审查、版本和时效绑定、声明与观测一致性、未结案事故隔离。
- `npm run test:recovery-provider-conformance`：34 项模拟测试，覆盖能力声明失实、重复副作用、旧 Epoch、ACK 丢失、不可确认的终态及不允许自动重发 UNKNOWN。
- 探针和事故记录目前是**测试注入/候选接口，不具备真实下游探针或持久化事故隔离**；发布仍 **NO_GO**。

## Week 11 / Day 71 午练：Provider 能力矩阵与 fail-closed 候选路由

- [午练实现](docs/day71-noon-provider-matrix-fail-closed.md) 将早课的能力审计与 Day 70 Effect Ledger 阶段组合：仅 pending 的首次派发候选、UNKNOWN 的只读查询/新认领候选，任何情况都禁止盲目重发。
- `npm run test:recovery-provider-matrix` 运行 28 个合同检查，覆盖四类模拟 Provider、身份伪造、状态绕过、保留期和 Day 70 Reconciliation；没有真实外部调用或账本写入。
- 状态仍是 **NO_GO**：它只做静态候选评估，不批准实际副作用。

## Week 11 / Day 71：外部 Provider 能力审计

- [Day 71 早课：Provider Capability Contract](docs/day71-morning-provider-capability-contract.md) 对原有 Day 70 UNKNOWN 决策前置安全能力评估，区分原子幂等、下游 Epoch Fencing、权威终态查询、稳定收据身份、终局否定查询、幂等作用域和保留时长。
- 运行 `npm run test:recovery-provider-capabilities` 验证 15 项纯合同断言；只建立接线前候选门禁，不调用真实第三方，也不批准 UNKNOWN 自动重发。
- **发布状态：NO_GO**，真实 Provider Adapter、IAM、收据持久化及旧路径隔离均未验收。

## Week 10 / Day 64–70：Recovery 发布安全审查

- Day 64–65：纯 Control Prepare、Selective SQLite Finalizer、Atomic Control-only 候选路由。
- Day 66–67：持久化执行 owner、共享 Command Claim 和 Run-level CAS，防止跨路由重复命令写入。
- Day 68–69：Ingress 信任边界、权限撤销后的重放检查、授权 Revision 在 Claim/Finalizer 的同库 Fence。
- Day 70：外部 Effect Fence 契约、SQLite Intent Ledger 和模拟 Sink、UNKNOWN 的只读远程 Reconciliation 决策；**没有**真实第三方 exactly-once。
- [Week 10 Checkpoint](docs/checkpoints/week10-day70.md) · [Day 70 晚练审查](docs/day70-evening-effect-reconciliation-and-cutover.md)

运行 `npm run test:recovery-effect-reconciliation` 可复现 UNKNOWN 停止自动重试、远程证据分支与本地模拟 Sink 丢 ACK 情况。

**发布状态：NO_GO。** 缺真实 HTTP/CLI 与 IAM/ACL、旧 Service 旁路隔离、外部 Sink 协议、事实核对接口、多进程发布验收。不得将本仓库候选测试当成生产级 exactly-once。

---

## 现在这套 Runtime 已经做到什么程度

目前主链已经从“能跑 Agent”推进到了“开始考虑生产环境里的失败、取消、重复执行和恢复”。

```text
User Request
↓
Runtime Lifecycle
↓
Run Admission / Bounded Queue / Backpressure
↓
Queue Timeout / Cancellation
↓
Agent Loop
↓
Run Budget / Budget Policy
↓
Cost-aware Model Router
↓
Provider Circuit Breaker
↓
Timeout + Same-provider Retry
↓
Reliability Fallback
↓
Tool Permission / Authorization / Human Approval
↓
Tool Effect Policy
↓
Idempotency / Audit
↓
Durable Tool Execution
↓
Checkpoint + Version / CAS
↓
Persistent / Transactional Checkpoint Store
↓
Recovery Coordinator
↓
Recovery Planner
↓
Reconciler
↓
Tracing / Token / Cost
↓
Structured Result
```

统一生产入口：

```text
src/runtime/production-runtime.ts
```

---

## Day 1～44 能力演进

### 1. Agent 基础

前面的课程先把 Agent 最基本的运行骨架搭起来：

- 统一的 LLM Provider 抽象
- `callLLM`
- Tool Calling
- Tool Registry / Executor
- Agent Loop
- Structured Output
- Planner / Action / Observation
- Reflection / Guardrail
- Multi-Agent Routing / Delegation

这些代码最终都不是独立存在，而是逐步汇入当前 Runtime。

---

### 2. Evaluation 与 Observability

Agent 能跑以后，开始解决“怎么知道它跑得好不好”。

目前已经包含：

- Routing Evaluation
- Trajectory Evaluation
- Trace Recorder
- Trace Summary
- Token Usage
- Cost Calculation
- Budget Guard
- Run Budget
- Budget Policy

核心思路是：不能只看最终回答，还要看 Agent 中间到底做了什么。

---

### 3. Security

目前 Tool 执行已经不再是模型说调就直接调。

现在包含：

- Tool Permission
- Authorization
- Human Approval
- Audit Log
- Idempotency
- Prompt Injection Guard
- Sensitive Data Sanitization
- Tool Result Sanitization
- Tool Effect Policy

其中 Day 35 开始增加 Tool 的副作用语义：

```text
none
internal_write
external_side_effect
```

并显式描述：

- 是否允许安全重试
- 是否必须使用 idempotency key
- 是否存在补偿机制
- 副作用是否可恢复

对应实现：

```text
src/security/tool-effect-policy.ts
src/security/secure-tool-executor.ts
src/security/idempotency.ts
```

---

## Cancellation：现在已经真正穿透到执行链

之前 Runtime 只能取消 queued Run，但 Running Run 内部仍可能继续执行。

目前已经补齐这条链：

```text
AbortSignal
↓
Production Runtime
↓
Agent Loop
↓
LLM Invoker
↓
Retry / Fallback
↓
LLM Provider

AbortSignal
↓
Agent Loop
↓
Tool Executor
↓
Secure Tool Executor
↓
Tool Handler
```

也就是说，现在取消发生以后：

- 不再继续发起新的 Agent Step
- 不再继续 Retry
- 不再切换 Fallback Provider
- Tool Handler 可以收到 `AbortSignal`
- Secure Tool 也能收到取消信号

相关代码：

```text
src/runtime/llm-invoker.ts
src/runtime/reliability-fallback.ts
src/security/secure-tool-executor.ts
src/tools/executor.ts
src/agent/agent-loop.ts
```

---

# Day 35～41：Durable Agent Runtime

这几天的重点已经从“失败以后抛异常”转向：

> Agent 执行到一半挂了以后，系统怎么知道之前到底执行到了哪里？

## 1. Tool Effect Policy

不是所有 Tool 都可以简单 Retry。

例如：

```text
search_customer
```

失败以后通常可以重新查。

但：

```text
send_message
execute_refund
create_order
```

如果请求已经发出，只是客户端没收到结果，就不能直接再执行一次。

因此 Runtime 现在会先判断 Tool 的副作用性质。

---

## 2. Durable Tool Executor

核心实现：

```text
src/runtime/durable-tool-executor.ts
```

执行 Tool 时不再只有：

```text
execute()
↓
result
```

而是：

```text
Persist Intent
↓
Execute Tool
↓
Persist Outcome
```

Tool 的执行状态目前可以记录为：

```text
never_executed
started
executed
failed
unknown
cancelled_before_execution
```

其中最重要的是：

```text
unknown
```

它代表：

> Tool 可能已经执行，也可能没有执行，Runtime 当前无法直接确定。

这也是 Durable Agent 必须解决的问题。

---

## 3. Checkpoint

Checkpoint 定义在：

```text
src/runtime/checkpoint.ts
src/runtime/checkpoint-store.ts
```

Checkpoint 会记录：

- Run ID
- 当前 Step
- Resume Boundary
- Tool Execution Record
- Idempotency Key
- Tool Outcome
- Version
- Updated Time

当前 Resume Boundary 包括：

```text
ready_for_llm
ready_for_tool
waiting_approval
reconciling_tool
ready_for_next_step
completed
```

---

## 4. Version + CAS

Day 39 开始解决另一个问题：

> 如果两个恢复进程同时修改同一个 Checkpoint 怎么办？

当前 `CheckpointStore` 已加入 Version / Compare-And-Swap 语义。

写入时必须提供：

```text
expectedVersion
```

如果当前版本和调用方预期不一致，会抛出：

```text
CheckpointConflictError
```

这样可以避免旧状态把新状态覆盖掉。

当前实现：

```text
InMemoryCheckpointStore
```

这里要特别说明：

**目前还不是数据库持久化。**

现在完成的是：

```text
Checkpoint Model
+
Version
+
CAS
+
Recovery Contract
```

下一阶段再把这套接口接到 PostgreSQL / SQLite / Redis 等真正的进程外存储。

---

## 5. Recovery Planner

实现：

```text
src/runtime/recovery-planner.ts
```

恢复逻辑不会让 LLM 自己猜，而是由确定性的 Runtime Policy 决定。

当前 Recovery Action：

```text
skip
retry
reconcile
suspend
```

大致语义：

| 状态 | 处理方式 |
| --- | --- |
| 已确认执行成功 | skip |
| 已确认没执行，且安全重试 | retry |
| 有副作用但执行结果未知 | reconcile |
| 无法安全判断 | suspend |

原则很简单：

> 不确定的时候，不重复制造副作用。

---

## 6. Reconciler

实现：

```text
src/runtime/reconciler.ts
src/runtime/recovery-runtime.ts
```

对于支付、退款、创建订单、发消息这类外部副作用 Tool，单靠本地状态并不足以判断它是否已经执行。

因此需要通过业务系统再次查询真实状态。

例如：

```text
execute_refund
↓
网络超时
↓
本地不知道退款是否成功
↓
Reconciler 查询支付系统
↓
executed / never_executed / unknown
```

然后再交给 Recovery Planner 决定：

```text
skip / retry / suspend
```

---

# 当前 Durable Execution 主链

```text
Tool Call
↓
Tool Effect Policy
↓
Persist started
↓
Secure Tool Executor
↓
Tool Handler
↓
Persist executed / failed / unknown
↓
CheckpointStore
↓
Version / CAS
↓
Process Restart / Recovery
↓
Recovery Planner
↓
Reconciler
↓
skip / retry / reconcile / suspend
```

这一阶段的重点已经不再是“Tool 能不能调通”，而是：

> Tool 调到一半发生故障后，系统还能不能安全地继续。

---

## Day 40～41：Persistent / Transactional Checkpoint

Day 40 让 Checkpoint 第一次离开 `new Map()`：

```text
FileCheckpointStore
↓
write temporary file
↓
rename
↓
new Store instance
↓
load checkpoint
```

它验证的是：

```text
Process / Store Restart
↓
Checkpoint 仍然存在
```

Day 41 进一步把 CAS 语义下沉到共享存储 Contract：

```text
TransactionalCheckpointStore
↓
insertIfAbsent
updateIfVersion
↓
Storage-level atomic compare + write
```

同时新增 `CheckpointRecoveryCoordinator`，把：

```text
Conflict
↓
reload
↓
re-plan
```

正式封装进 Recovery Runtime。

相关实现：

```text
src/runtime/checkpoint-recovery-coordinator.ts
src/runtime/file-checkpoint-store.ts
src/runtime/transactional-checkpoint-store.ts

src/demos/checkpoint-recovery-coordinator-test.ts
src/demos/persistent-checkpoint-test.ts
src/demos/transactional-checkpoint-test.ts
```

重要边界仍然保留：当前仓库还没有真正连接 PostgreSQL/SQLite，因此生产级跨进程 CAS 由 `TransactionalCheckpointDatabase` Contract 表达，还需要后续数据库 Adapter 落地。

---

# Deployment Boundary

目前 Deployment Runtime 已包含：

- Run Admission
- Bounded Queue
- Backpressure
- Queue Timeout
- Queued Cancellation
- Running Cancellation
- Runtime Lifecycle
- Graceful Drain
- SIGTERM / SIGINT Adapter
- Shutdown Coordinator
- Shutdown Deadline
- Shutdown Escalation
- Readiness Validation
- Circuit Breaker
- Reliability Fallback

Runtime 生命周期：

```text
RUNNING
↓
DRAINING
↓
STOPPED
```

进入 `DRAINING` 后：

- 停止接收新的 Run
- 清理 queued Runs
- 等待 active Runs
- Process Signal Adapter 负责接入 SIGTERM / SIGINT
- Shutdown Deadline 控制最长优雅关闭时间

---

# 项目目录

```text
src/
├── agent/
│   └── agent-loop.ts
│
├── llm/
│   ├── client.ts
│   ├── types.ts
│   └── providers/
│
├── tools/
│   ├── registry.ts
│   ├── executor.ts
│   └── types.ts
│
├── planning/
├── multi-agent/
├── evaluation/
├── observability/
│
├── security/
│   ├── secure-tool-executor.ts
│   ├── tool-permission.ts
│   ├── tool-effect-policy.ts
│   ├── authorization-service.ts
│   ├── approval-store.ts
│   ├── idempotency.ts
│   ├── audit-log.ts
│   └── prompt-injection-guard.ts
│
├── runtime/
│   ├── production-runtime.ts
│   ├── llm-invoker.ts
│   ├── resilience.ts
│   ├── reliability-fallback.ts
│   ├── provider-circuit-breaker.ts
│   ├── run-admission-controller.ts
│   ├── runtime-lifecycle.ts
│   ├── run-budget.ts
│   ├── budget-policy.ts
│   ├── checkpoint.ts
│   ├── checkpoint-store.ts
│   ├── file-checkpoint-store.ts
│   ├── transactional-checkpoint-store.ts
│   ├── checkpoint-recovery-coordinator.ts
│   ├── durable-tool-executor.ts
│   ├── recovery-planner.ts
│   ├── reconciler.ts
│   └── recovery-runtime.ts
│
└── demos/
```

---

# 本地运行

安装依赖：

```bash
npm install
```

编译：

```bash
npm run build
```

运行基础 Demo：

```bash
npm run demo
```

---

# Runtime 测试

常用测试：

```bash
npm run test:runtime-contract
npm run test:runtime-integration

npm run test:model-routing
npm run test:reliability-fallback
npm run test:circuit-breaker
npm run test:readiness

npm run test:run-admission
npm run test:lifecycle

npm run test:shutdown
npm run test:signal-shutdown
npm run test:shutdown-deadline
npm run test:shutdown-escalation

npm run test:running-cancellation
npm run test:inflight-cancellation
npm run test:resilient-cancellation

npm run test:durable-recovery
npm run test:checkpoint-recovery
npm run test:persistent-checkpoint
npm run test:transactional-checkpoint
```

---

# CI

仓库已经配置：

```text
.github/workflows/runtime-tests.yml
```

当前 CI 会验证：

```text
TypeScript Build
↓
Runtime Contract
↓
Production Runtime Integration
↓
Resilient Cancellation
↓
Durable Recovery
↓
Checkpoint Conflict Recovery
↓
Persistent Checkpoint Restart/CAS
↓
Transactional Multi-instance CAS
```

当前最新代码已经通过以上检查。

---

# 当前边界

现在这套代码已经开始具备 Production Runtime 的骨架，但还没有把所有问题都做完。

目前明确没有假装完成的部分：

### 1. 已有 File 持久化原型，但生产数据库 Adapter 还没接入

当前已经有：

```text
InMemoryCheckpointStore
FileCheckpointStore
TransactionalCheckpointStore
```

其中 `FileCheckpointStore` 用于验证 Restart Contract：新的 Store 实例仍能读回 Checkpoint；它只在同一 Node.js 进程内串行化文件读写，**不冒充跨进程原子 CAS**。

`TransactionalCheckpointStore` 已把生产级存储需要的原子语义抽象出来：

```text
insertIfAbsent
updateIfVersion
```

下一步仍需要接入真正的：

```text
PostgreSQL / SQLite
```

由共享存储执行原子的 Conditional Update。

### 2. Recovery 还需要真正接入业务 Tool

目前 Recovery / Reconciler 的 Runtime Contract 已经有了。

后面需要逐步给真实 Tool 实现：

```text
PaymentReconciler
RefundReconciler
OrderReconciler
MessageReconciler
```

### 3. 还需要继续补生产环境运营能力

例如：

- Persistent Checkpoint
- Metrics
- Recovery Dashboard
- Dead Letter / Suspended Run 管理
- Distributed Lock
- Multi-instance Recovery
- 更完整的 CI/CD
- Production Deployment

---

# 这套项目现在在解决什么

如果只看前几天，Agent 很像：

```text
LLM + Tools + Loop
```

但随着课程继续推进，Runtime 已经逐渐变成：

```text
Agent Runtime
=
Reasoning
+ Tool Execution
+ Security
+ Observability
+ Budget
+ Reliability
+ Cancellation
+ Lifecycle
+ Durable Execution
+ Recovery
```

这也是这个仓库后续继续演进的主线。

具体阶段设计和课程说明见：

```text
docs/
```


---

## Day 42～44：SQLite、Recovery Observability 与人工恢复

这一阶段把 Durable Agent 从“能恢复”继续推进到“能持久化、能观测、能运营”。

核心链路：

```text
SQLite-backed Checkpoint
↓
Crash Recovery
↓
Recovery Event
↓
Metrics / Suspended Runs
↓
RecoveryOperationService
↓
Authorization + Audit
↓
Checkpoint Version + Control Version
↓
quarantine / release / resume / dead-letter
```

Day 44 额外引入独立的 Operational Control Version。它和 `checkpoint.version` 解决的是两个不同维度的并发问题：

```text
checkpoint.version
→ Runtime 状态是否过期

control.version
→ 运营控制状态是否过期
```

人工操作仍然不能直接调用副作用 Tool。所有 retry / reconcile / resume 都必须重新进入 Recovery Coordinator，由 ToolEffectPolicy、Reconciler、Idempotency 和 CAS 共同决定下一步。

对应实现：

```text
src/runtime/recovery-operations.ts
src/runtime/recovery-metrics.ts
src/runtime/suspended-run-registry.ts

src/demos/recovery-operations-test.ts
src/demos/recovery-operation-lifecycle-test.ts
```


## Day 45：Durable Command + Outbox

Human Recovery 继续从“有操作按钮”推进到“命令本身可恢复”。

新增：

- Durable Recovery Command Record：稳定 commandId、状态机和 version/OCC
- In-memory Command Store：insertIfAbsent + updateIfVersion
- Recovery Outbox：pending / dispatched、attempts、version
- Outbox Dispatcher：按 at-least-once 语义重试投递
- Consumer Idempotency：通过 eventId / commandId 抵抗重复事件

当前 Day 45 午练仍然是 Contract / In-memory Prototype，用来验证命令幂等与 Outbox 重投语义；它还没有冒充数据库事务。下一步会把 RecoveryOperationService、Checkpoint / Control 变化、Command Record 与 Outbox Record 放进同一个 SQLite/PostgreSQL 事务边界。


## Day 46：Prepare / Commit 分离

Day 45 已经有 SQLite Recovery Finalization Unit of Work。Day 46 开始把 Recovery 决策和持久化提交拆开：

```text
Prepare
→ Planner / Reconciler
→ PreparedRecoveryTransition
→ 不写数据库

Commit
→ expected versions
→ Checkpoint / Control / Command / Outbox
→ 单事务落库
```

Morning 新增 `src/runtime/recovery-preparation.ts`，先建立 persistence-free preparation contract。它保留 observed checkpoint version，计算 next checkpoint，但不自行递增版本或保存状态。后续会逐步把 Coordinator / RecoveryOperationService 接到这一边界。


---

## Day 46：Prepare / Commit + Transaction-aware Committer

Recovery 现在开始把“决策”和“持久化提交”拆开：

```text
CheckpointRecoveryCoordinator
↓
prepareRecoveryTransition()
↓
PreparedRecoveryTransition
↓
RecoveryTransitionCommitter
```

默认 Committer 仍可使用 `CheckpointStore`，而 SQLite 事务版本通过：

```text
src/runtime/sqlite-recovery-transition-committer.ts
```

桥接到 Day 45 的 `SQLiteRecoveryFinalizationUnitOfWork`。

一次需要持久化的恢复现在可以把：

```text
Checkpoint
+ Recovery Control
+ Durable Command
+ Outbox
```

放进同一个 SQLite Transaction 中提交。

对应回归测试：

```text
npm run test:recovery-preparation
npm run test:recovery-committer
npm run test:sqlite-recovery-committer
```

注意：复合事务的冲突可能来自 checkpoint / control / command / outbox。只有 checkpoint-only conflict 适合在 Coordinator 内部直接 reload + re-prepare；复合冲突需要更外层的 Human Recovery Orchestrator 重新加载整组事实。


## Day 47：Durable Recovery Operation Orchestrator

Day 47 开始把 Durable Command、Human Recovery 和 Day 46 的事务化 Commit 组装成一条可重复调用、可崩溃恢复的命令处理链。

Morning 先固定 command identity 与 replay 语义：

```text
commandId 不存在
→ accept_new

terminal command
→ replay_terminal
→ 不重新执行 Recovery

accepted / executing
→ resume_in_flight
→ 重新读取事实后恢复，不盲目重放 handler
```

新增：

```text
src/runtime/durable-recovery-operation-orchestrator.ts
docs/day47-durable-recovery-operation-orchestrator.md
```

同时 Durable Command Record 增加可选 `resultSnapshot` Contract，为后续稳定重放 terminal response 做准备。


### Day 47 午练：Durable Command 真正进入执行入口

Morning 只固定了 command identity 与 replay 判断，Noon 进一步实现：

```text
commandId 不存在
→ accepted
→ executing
→ RecoveryOperationExecutor
→ succeeded / rejected / failed
→ resultSnapshot

terminal command
→ replay stored result
→ 不重新执行 Recovery

accepted / executing
→ reload Checkpoint + Recovery Control
→ resume_in_flight
→ 不盲目重跑 handler
```

对应实现：

```text
src/runtime/durable-recovery-operation-orchestrator.ts
src/demos/durable-recovery-operation-orchestrator-test.ts
docs/day47-noon-durable-recovery-operation-orchestrator.md
```

当前这一版故意把 `resume_in_flight` 停在“重新读取 durable facts”这一步，不把 executing 误判成“上次没执行”。下一步会把这条 in-flight path 接到 Day 46 的 transaction-aware Recovery Commit，让崩溃恢复重新加载 Checkpoint / Control / Command 后再决定下一步。


## Day 72 午练：远程 Applied 收据只入证据库，不推进终态

在现有 \`SQLiteRecoveryExternalEffectLedger\` 上新增 \`persistReviewedRemoteAppliedReceipt()\`：
同一个 SQLite \`BEGIN IMMEDIATE\` 内再次检查 UNKNOWN/Epoch、原始 Intent、
executing v2 Command、owner、租户与授权修订，再复用 Day 72 早课的可信收据审查。
\`recovery_remote_applied_receipts\` 强制 UNIQUE(provider_id,receipt_id)、
UNIQUE(effect_id)、UNIQUE(provider_id,idempotency_key)。
两连接竞争相同收据只允许一行；跨 Effect 重绑定拒绝；
远程收据存在时禁止仅凭本地模拟 Sink 无收据将 UNKNOWN 置回 pending。
结果只为 stored/already_stored，**Effect 仍为 UNKNOWN、Command 仍为 executing v2**。

验证：\`npm run test:recovery-remote-receipt-persistence\`。
**这是同库候选存储，不是真实供应商认证；Registry 仍非 SQLite 原子权威，
未实现终态 CAS、正式入口、真实 IAM 或远程 exactly-once。NO_GO。**


## Day 73 早课：Receipt Consumption CAS

新增 `planRemoteReceiptConsumption()` 纯合同，接续 Day 72 的可信远程收据与只读终态审查；它只提出下一笔原子事务所需的 receipt、effect、epoch、Command/Control 版本约束，不执行终态写入。测试：`npm run test:recovery-receipt-consumption-contract`。真实消费 Finalizer 尚未实现，发布 **NO_GO**。


## Day 73 午练：远程收据消费与终态 CAS（同库候选）

新增 `SQLiteRecoveryRemoteReceiptFinalizer`，在同一 SQLite 事务里重查 UNKNOWN/Epoch、授权、Provider 候选、Checkpoint/Control 版本，原子写入收据消费、Control、Command terminal、Outbox 与 Effect committed。稳定重放不重复 Outbox；测试覆盖撤权、冲突、故障回滚与重启。运行 `npm run test:recovery-receipt-consumption-sqlite`。真实 Provider/外部 Registry 尚未实现跨系统原子一致性，发布 **NO_GO**。参见 `docs/day73-noon-receipt-consumption-sqlite.md`。


## Day 73 晚练：终态双写者隔离与重放证据核对

修复午练 Finalizer 的 TypeScript 控制流收窄错误（初次 CI Build 失败，修复提交的 CI 已通过）；为旧通用 `SQLiteRecoveryFinalizationUnitOfWork.commit()` 加同库 Effect Intent 拦截，避免绕过远程收据消费直接终态提交。强化新 Finalizer 的 `replayed_terminal`：必须核对 Outbox 事件的收据、Provider 和 Command 身份，不能只看事件行存在。新增 `npm run test:recovery-receipt-finalizer-boundary`，覆盖旧写入者绕过、Outbox 收据篡改、Consumption 错绑和事件 ID 错绑。详见 `docs/day73-evening-receipt-finalizer-boundary.md`。**仅候选 SQLite 边界，生产 NO_GO。**


## Day 74 午练：同库 Outbox Delivery Claim / Lease

新增 `SQLiteRecoveryOutboxDeliveryClaimer`，在 Day 73 的同一 `recovery_outbox` 表上使用 `BEGIN IMMEDIATE`、事件版本 CAS 和 `recovery_outbox_delivery_leases` 持久化租约；两个连接不能同时领取有效租约，过期后可重新认领且保持原始 `eventId`。只有受信消费者 ACK（与 eventId、当前 leaseToken、有效期绑定）才将事件标记 `dispatched`。验证：`npm run test:recovery-outbox-delivery-lease`。**未接真实 Publisher/Consumer；来源字符串不能替代认证；消费者去重与跨进程验收未完成，发布 NO_GO。**

## Day 83 午练：持久策略版本水位与 SQLite CAS（候选）

在 Day 83 早课的可信水位合同上新增 `SQLiteRecoveryWriterTrustWatermarkStore`，使用 SQLite `BEGIN IMMEDIATE` 实现两个连接的持久化 `(deploymentId, revision, policySha256)` CAS。`bootstrapRecoveredWriterTrust` 先校验受信 Source 提供字节的 SHA-256、策略自身有效期和指纹列表，再 CAS，支持重启时同版本同摘要的精确重放；旧 revision、同版换摘要、缺失锚、Source 故障保持 Fail Closed。运行 `npm run test:recovery-writer-trust-watermark-sqlite`。详见 `docs/day83-noon-trust-watermark-sqlite.md`。该实验不实现真实策略签名、生产共享策略权威、活跃实例即时撤权、旧 Writer OS 挂载隔离或真实 ACK；**生产 NO_GO**。
