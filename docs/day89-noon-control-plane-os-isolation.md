# Day 89 午练｜真实 Linux 分 UID 控制面 SQLite 拒写实验

日期：2026-11-18｜Week 13 / Day 89｜12:00

## 承接早课

Day 88 已证明旧 `Store` 公共管理方法与直接 SQL 可以绕开应用层鉴权。Day 89 早课列出了旁路清单。本次不改变旧 TypeScript API，而是在一次性 Linux 环境下测试不同 OS 身份能否写入 control.sqlite、-wal、-shm 及目录。

## 实验拓扑

- Linux 主进程：CI 的 root，仅负责在 `/tmp/agent-day89-os-*` 创建夹具、切换 UID、核对和清理。
- 独立子进程 UID 65021：Controller，用 Node 22 内置 `node:sqlite` 创建数据库、WAL 与 SHM，保持数据库连接打开。
- 独立子进程 UID 65022：Worker，对三个已存在的文件执行不修改内容的 `O_RDWR` 打开尝试，并试图在控制目录中创建新文件。每项都必须得到 `EACCES`。
- 控制目录由 Controller 拥有，目录模式 `0711`；数据库及 WAL/SHM 的组与其他写权限不允许开放。两个子进程独立运行，分别断言 `process.getuid()`。

## 运行

**只在 disposable Linux CI/VM 运行，切勿在生产主机使用 root 执行此脚本。**

```bash
npm ci
npm run test:recovery-writer-legacy-control-surface
npm run test:recovery-writer-control-os-isolation
```

执行后打印 `isolated_os_permissions_observed`、两个测试 UID、四项拒绝和 `publishAuthorized: false`。缺少 Linux、sudo/setpriv、root、任何文件或任何一项拒写，脚本失败而不是假装 PASS。finally 退出控制面进程并移除临时夹具。

## 边界与下一步

这是真实 Linux DAC 对**新打开文件**的拒写观察，但仍只是同一主机、同一挂载命名空间、一次性 /tmp 夹具。并未运行生产控制服务，没有测试旧 Worker 已持有的可写 FD、容器重新挂载、历史数据库迁移、实际受信 mTLS 身份、不可篡改审计或 Consumer ACK。旧 Store API 保留兼容，现有 TypeScript Runtime 并未变为生产双进程架构。

晚练需要专门制造旧 FD / 回滚权限恢复反例，并明确将其列为生产 NO_GO 的阻断条件。

## Day 89 晚练修复补充

首次 CI 运行 #44234964587 未通过：root 主进程的子进程切到 UID 65021 后不能访问 GitHub checkout 私有路径，报 `MODULE_NOT_FOUND`。修复后先把只读脚本复制到本轮 `/tmp` 夹具，再用 `setpriv` 执行；修复原因是脚本可访问性，与 SQLite 文件是否拒写是不同问题。详见 [晚练反例](day89-evening-control-handoff-negative-lab.md)。
