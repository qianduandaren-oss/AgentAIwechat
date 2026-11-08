# Day 79 晚练｜单一写入发布门禁、回滚与旧 SQL 旁路

日期：2026-11-08（Asia/Shanghai）｜Week 12 / Day 79｜20–30 分钟。

## 承接早课与午练

早课明确 Single Writer Authority 不能等同于一个 TypeScript 接口；午练已把候选服务入口接在 Cutover Guard、可信 ACK Adapter 合同、SQLite Epoch + Lease + CAS 之上。本次检查发布条件及回滚，保留现有 Runtime，不创建独立业务实现。

## 新增候选发布证据审查

`src/runtime/recovery-single-writer-release-review.ts` 提供纯 `reviewSingleWriterReleaseEvidence()`：九类证明必须齐全、通过、方法匹配、绑定同一 deploymentId、处于新鲜窗口内。任一缺失、失败或证据过期 → hold；全部满足也**只能返回 ready_for_external_security_review、publishAuthorized=false**。所谓证明是否真实，必须由独立可信探针与部署平台在外部验证，传入假布尔值不能授权生产。

九类证据：旧进程 DB 写权限 OS 拒绝、DB 目录写权限 OS 拒绝、旧 Dispatcher 无法重启、raw ACK 入口被阻断、RPC 鉴权授权通过、真实消费者 ACK 验证通过、混合版本直写被拒、回滚后仍拒绝旧版本、Epoch/Lease/CAS 的 CI 通过。

## Day 79 晚练测试

`npm run test:recovery-single-writer-release` 通过 TypeScript 编译后运行 `day79-evening-single-writer-release-test.ts`，覆盖：

1. 九项证明齐全只进入**外部人工安全审查**，绝不授权 publish。
2. 每项缺失、失败均 fail-closed。
3. 时效过期、未来时间、不同 deploymentId、错误探测方式均拒绝。
4. Cutover Guard 发现回滚时混合版本复活必须拒绝。
5. 使用真实 SQLite 管理连接直接执行 UPDATE **故意成功**，证明不隔离 OS 权限就没有强制 Single Writer Authority。

第五项是明确标记的**负向安全验收**，不是安全行为。该代码不能放入生产。

## 必须在真实部署环境进一步验收

- 使用与 Trusted Delivery Service 不同的 OS uid/gid、不同只读/无 DB 挂载的旧 Worker 测试 `open + UPDATE` 实际被拒；同时检查 DB 所在目录、WAL/SHM 文件、旁路脚本以及部署编排。
- RPC/IPC 的真实身份认证、授权与审计；拒绝外部自报 epoch、owner、consumerContract。
- 真实消费者 ACK 密码学/可信通道验证，不把模拟 Adapter 算作验收通过。
- 混合版本部署、旧 Worker 重启、回滚旧镜像都不得恢复 DB 写权限；CI 必须真实绿色。
- 任一失败持续 NO_GO。开发环境可以模拟逻辑，不能把模拟变成部署证明。

## CI 修复

发现之前 `.github/workflows/runtime-tests.yml` 中 `Day 75 noon authenticated ACK candidate` 被放在 `actions/checkout`、Node 安装及 `npm ci` 之前，导致历史 Actions 在第一个步骤直接失败、后续测试全 skipped。将此步骤移至依赖安装 / build 之后，并把 Day 75–79 已存在及本次回归脚本列入工作流。测试结果以 GitHub Actions 后续实际结论为准。

## 下一步

Day 80：从候选审核推进真实部署隔离方案，设计不同 OS 身份的 SQLite Writer Service、无写权限旧 Worker，围绕可执行拒绝探针做验收。发布仍为 NO_GO。
