# Day 81 早课｜受信 IPC/RPC：客户端只提交业务意图，不提交写入者身份

日期：2026-11-10（Asia/Shanghai）｜Week 12 / Day 81｜15–25 分钟。

## 承接 Day 80

Day 78 的 SQLiteFencedOutboxDelivery 已在同一事务检查 Epoch、Lease 和 Version CAS；Day 79 的 RecoverySingleWriterCandidateService 已将 ownerId、Epoch、时钟和 ACK Adapter 作为可信依赖。Day 80 的 OS 实验又证明了两件事：新旧 UID 隔离可以让新的文件打开失败，但已经持有的可写 FD 不会被 chmod 自动撤销。生产 Single Writer 仍 NO_GO。

现在要处理的是：当 Worker 不再能直接触碰 SQLite，怎样向唯一受信 Writer 发送业务请求，并防止调用方伪造 writer 身份？

## 目标架构（候选，未部署）

```text
Worker（无 SQLite 目录挂载）
  │ claim_outbox / confirm_outbox（不含 Epoch、ownerId、dbPath）
  ▼
IPC / RPC 身份验证 + 逐操作授权 + 大小限制
  │ 已验证的 caller context（仅由通信层生成）
  ▼
RecoverySingleWriterCandidateService（Day 79，仍是候选）
  │ 受信 coordinator 的 ownerId/Epoch、服务端 clock
  │ 消费者原始 ACK 经真实受信 Adapter 验证
  ▼
SQLiteFencedOutboxDelivery（Day 78）
  └─ BEGIN IMMEDIATE → Epoch + Lease + CAS → COMMIT
                  ▼
         Writer 独占可写 SQLite 目录
```

**前提是 Day 80 的部署隔离也必须真实成立。** 在同 UID 可写目录中加一层 RPC，并不能阻止旧 Worker 绕过它。

## 为什么身份不能放在 JSON 请求体里？

一个经过网络传来的 `{ "ownerId": "writer", "epoch": 9 }` 只是客户端字符串，不是权限凭据。即使 `workerId` / `epoch` 字段在 TS 里被声明为 `readonly`，运行时仍可被伪造。服务必须从经过验证的传输上下文得到调用方身份；真正的 Writer Epoch 则从服务端协调器读取。

Unix domain socket 可以配合目录权限和操作系统提供的 peer credentials（需验证所用运行时/库是否真正暴露并核验）；仅知道 socket 路径或调用方声称一个 UID 不算认证。远程 TCP 可用双向 TLS 和证书身份映射，单靠一个自填 Header 不行。无论哪种方案，都需针对 `claim_outbox` 与 `confirm_outbox` 单独授权、记录审计和限制流量/报文长度。

## 本次最小代码合同

新增 `src/runtime/recovery-writer-rpc-contract.ts`：`RecoveryWriterWireRequest` 只有两类带判别字段的业务意图：`claim_outbox` 与 `confirm_outbox`；`VerifiedTransportCaller` 是**服务端注入**上下文（不是请求体字段）；`RecoveryWriterRequestHandler` 只定义待实现的候选端口。

- `requestId` 用于关联日志/响应，**不是**消费者幂等键；必须继续使用稳定的 eventId + Consumer Inbox。
- `rawConsumerResponse` 是不可信输入，真实 ACK Adapter 验证后才可能提交数据库事务。
- 仍须在运行时拒绝额外的 `ownerId`、`epoch`、`dbPath`、`nowEpochMs` 等字段；TS 类型本身不会阻止它们出现在 JSON 内。
- 统一 `hold` 返回 fail closed；具体长度上限、通道认证和 dispatch 逻辑安排在午练实现与测试。

## 3 个工程原则

1. **调用方身份来自可信通道，不来自 JSON / Header 自报。** 请求体只表达想做的业务动作。
2. **RPC 身份 != Writer Epoch。** 身份授权由 IPC/RPC 边界负责，Epoch 由内部协调器读取，最终由 SQLite 写事务重查。
3. **服务入口 != 文件隔离。** 混合镜像、回滚、遗留 FD、WAL/SHM、真实消费者 ACK 都仍是生产 GO 的独立前提。

## 思考题

请求体没有 `epoch` 字段，旧进程也只能走 IPC，但服务端相信 `X-User-Id: writer` 就给 `confirm_outbox` 权限，是否安全？

答案：不安全。Header 是客户端可伪造数据，除非有可信的网关对它进行认证、覆盖并在不可绕过的通道中传递。若有经过验证的 caller identity，还必须做逐操作授权；消费者 ACK 要另行验证，不能和调用方身份混为一谈。

## 本日连续练习

- **12:00 午练**：基于现有 Day 79 candidate service，写最小的运行时请求白名单解析/授权适配层；负向测试额外字段、冒充主体、缺失 transport context 和错误操作。
- **18:00 晚练**：复盘请求重放、大小限制、取消/超时、授权撤销、可信 ACK 与部署隔离，形成可进入作品集的服务边界检查点。
- Day 81 不是 7 的倍数，不追加 Week Checkpoint；当前生产发布 **NO_GO**。

## 说明

仅提交类型合同与架构笔记，未提供真实 IPC Listener、mTLS / peer credential 验证、权限数据库或生产发布授权，也不宣称新增 CI 已通过。
