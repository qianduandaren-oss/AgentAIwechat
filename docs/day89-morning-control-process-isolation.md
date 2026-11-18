# Day 89 早课｜拆除管理旁路：从控制面进程隔离开始

日期：2026-11-18（Asia/Shanghai）｜Week 13 / Day 89

## 为什么仍然不能发布

Day 88 的 IsolatedCollectorControlPlaneService 已经保证**经过新入口**的授权、控制操作、SQLite 审计同事务提交；但 SQLiteWriterCollectorChallengeStore 仍公开三个 LAB-ONLY 方法：provisionLabTrustedKey()、issueChallenge()、revokeTrustedKey()。Day 88 晚练实际复现了旧 Store 直调、未经审计的 Key/Challenge 创建，以及直接 SQL 改写审计。这不是纯授权函数可以解决的。

## 目标边界

```text
独立控制面进程（cp_uid）
  ├─ 服务端完成 Peer 认证、Release 范围与 Role/ACL 校验
  ├─ 持有 control.sqlite / -wal / -shm 目录的唯一写权限
  ├─ Challenge 签发、撤销、消费 + 同库持久审计
  └─ 对 Worker 暴露最小权限的受认证 IPC/RPC
            ↑
Agent Runtime Worker（worker_uid）
  ├─ 不挂载控制面数据库写路径、不持有可写 FD
  ├─ 不持有 Challenge Store 实例
  └─ 仅通过受限入口提交已签名证据
```

特别注意：verifyAndConsume() 也会修改 Challenge 状态，不能以为 Worker 只调用消费方法，就可以安全地持有 control.sqlite 的写连接。进程分离还要配合不同 UID、数据库目录权限、WAL/SHM、旧 FD 排空及回滚限制。

## 本次落地：迁移前的静态清单

新增 scripts/day89-morning-legacy-control-surface-audit.mjs：

1. 确认旧三个 Lab 管理 API 仍存在，避免误以为兼容路径已消失；核对受限 Service 使用 executeAuditedControlCommand()。
2. 扫描 src 下 TypeScript 文件中显式的 .issueChallenge( / .provisionLabTrustedKey( / .revokeTrustedKey(；列出 Demo 中已知的旁路调用；若 src/runtime 出现新的显式直调则失败。
3. 不修改旧代码，不删除历史测试，不将扫描 PASS 当成生产级安全验收。

执行：`npm run test:recovery-writer-legacy-control-surface`。脚本是启发式字符串检查，不能发现别名调用、动态属性名、直接 SQL、旧进程可写 FD 或挂载旁路；不会授予生产 GO。

## 真实迁移的验收顺序

1. 为独立控制面提供服务端认证来源，Worker 无权构造认证上下文。
2. 控制库目录仅由 cp_uid 写；worker_uid 在 OS 层不得创建或写入 DB/WAL/SHM。
3. 将签发、撤销、消费写操作都收口进控制面；停止旧进程并验证所有预先打开的 FD。
4. 验证版本混合、回滚挂载与文件权限恢复的反例，并让独立观察者提交证据。
5. 把生产可信审计锚点、Consumer ACK 与发布证据审查接入控制面。缺证据 HOLD。

**目前只完成静态代码库存，生产 NO_GO。Day 89 午练开展一次性 Linux 进程/文件权限实验，晚练验证残留旁路和回滚。**
