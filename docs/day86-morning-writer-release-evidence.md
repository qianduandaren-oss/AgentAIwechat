# Day 86 早课｜部署证明必须来自独立观察，而不是 Writer 自报

日期：2026-11-15（北京时间）｜Week 13 / Day 86。**生产 NO_GO**。

## 继承 Day 85

Day 85 的严格 Factory 防止使用新入口时遗漏受信水位；静态代码扫描与独立 UID 的 WAL/SHM 权限实验揭示了旧进程、旧 FD、回滚恢复权限三条不能靠 TypeScript 消除的风险。Day 80 已证明 chmod 不能收回已打开 FD。

## 可信发布证据链（设计，未实现生产探针）

```text
受信部署控制面 / 不与 Worker 同权限的主机观察者
  → 收集 releaseId + deploymentId + 观察时间
  → 检查旧进程退出、可写 FD 排空
  → 验证旧 UID 对 DB/WAL/SHM 与目录的实际拒绝
  → 验证旧身份不能重新挂载，回滚镜像不能恢复访问
  → 检查唯一 Writer 挂载与原始 ACK 入口已关闭
  → 保存原始证据、采集器身份与可审计的摘要
  → 独立审查；缺一项 HOLD
```

新建 `recovery-writer-release-evidence.ts` 只做**元数据合同**：七项必需检查的完整性、无重复、绑定目标部署/发布版本、实验用 5 分钟新鲜度、摘要形状和不可自报。代码返回值最多是 `ready_for_isolated_deployment_probe`，而不是 production GO。

关键边界：SHA-256 字符串可以由任意进程伪造，`observerKind="independent_host_probe"` 也是任意可填写的字段。即使合同 PASS，也没有证实主机采集器被认证、文件描述符检查完整，或 OS 权限确实被强制执行。生产必须由部署控制面独立校验真实探针和证据链、锁定目录和 FD 的访问生命周期，并覆盖回滚时序。

## 实验/验收

```bash
npm ci
npm run test:recovery-writer-release-evidence
```

- 负向：生产申请、证据缺失、错配 releaseId、Worker 自报、时钟逆序/过期、缺检查、重复检查、失败与未知、摘要无效都 HOLD。
- 正向：仅合成七项完整元数据进入隔离探针的下一步，`publishAuthorized=false`。
- 没有生产级 mount/FD 扫描或 ACL、Consumer ACK；NO_GO。

午练方向：基于临时 Linux 环境采集独立进程与旧 FD 排空的最小证据，并验证缺采集能力时不假装 PASS。晚练再连接回滚镜像与混合版本的发布阻断。
