# Day 80 午练｜SQLite 目录权限：用真实 Linux UID 做负向探针

日期：2026-11-09，Week 12 / Day 80，20–25 分钟。继承 Day 80 早课的 Single Writer Deployment Isolation，不修改 Day 78/79 候选 Outbox 或 Release Review；生产继续 NO_GO。

## 新增的代码与检查

- `src/runtime/recovery-sqlite-writer-isolation-review.ts`：不信任输入拓扑声明。相同 UID、旧 Worker 挂载 DB、旧进程特权、允许重挂载、回滚恢复挂载等都返回 `hold`，通过也只代表可进入隔离探针，始终 `publishAuthorized=false`。
- `src/demos/day80-noon-writer-isolation-policy-test.ts`：对危险拓扑做单元负向测试。
- `src/demos/day80-noon-writer-isolation-os-probe.ts`：仅允许 `/tmp/day80-writer-lab.XXXXXX` 一次性夹具，创建测试 SQLite；以 `r+` 打开文件但不执行 UPDATE；用 `wx` 创建/删除空的目录 canary，检测真实当前 UID 是否有写权限。
- `scripts/day80-writer-isolation-lab.sh`：仅 Linux，执行同 UID 正控和 `sudo -n -u nobody` 旧身份拒绝探针。依赖可使用无交互 sudo 的隔离 CI/预发主机；在权限不足或探针异常时 fail closed。

```bash
npm ci
npm run test:recovery-writer-isolation-policy
npm run test:recovery-writer-isolation-lab
```

第二条命令是跨平台策略测试，第三条仅适用于受控的 Linux CI/临时环境。所有产生的数据库文件都在 `mktemp` 目录中，执行结束清理。**不要将真实生产数据目录替换进命令，不要在生产机器上执行验证实验。**

## 可观察输出与安全范围

| 执行账户 | 预期探针输出 | 结论 |
| --- | --- | --- |
| 当前创建者 UID | `UNSAFE_WRITABLE file=writable directory=writable` | 同 UID / 同挂载的旧进程不能算隔离 |
| `nobody`，0700 临时目录 | `OS_DENIED file=denied directory=denied` | 这个临时目录上的 Linux DAC 拒绝已被真实 OS 验证 |
| 不存在 sudo/nobody，探针无法运行 | 非零退出 | 不生成虚假 PASS / 不当发布证据 |

本练习并未安装生产 Writer Service，也没有证明旧容器没有挂载 DB、没有旧 FD、没有 root/capability 绕过、没有 WAL/SHM 或回滚漏洞。上面的正反例只证明 disposable fixture 上的特定 UID、目录与文件操作；真实混合版本、容器卷权限和消费者 ACK 仍须在相应环境独立验证。

## 练习检查点

1. 同 UID 正控必须返回 `UNSAFE_WRITABLE` 而不是 PASS。
2. 旧身份负控必须真实启动，并明确输出两个 `denied`；错误退出不能算权限拒绝。
3. 如旧进程使用 root、可重挂载、共享组/ACL，纯策略直接 `hold`。
4. 测试通过后仍保持 `publishAuthorized=false`，正式发布 NO_GO。

**晚上接续：**检查旧 FD 持有、容器混合版本与回滚拒绝证明的实际采集方案；Day 80 非七的倍数，不增加阶段总结。
