# Day 87 早课｜受信采集器身份与原始证据绑定

日期：2026-11-16（北京时间）｜Week 13 / Day 87｜08:00｜20–25 分钟。**生产 NO_GO**。

接续 Day 86 的 Deployment Attestation：七项 PASS、instance inventory、rollback manifest 原先都是调用方可以随意填的元数据。今天新增真实 Ed25519 签名校验合同，**只做隔离候选验证，不授权生产发布**。

## 链路与边界

控制面预置采集器 keyId -> 公钥，并独立提供 deploymentId、releaseId、observerId、hostId、mountNamespaceId、不可预测的 challengeId 与当前可信时间。采集器对固定顺序的 UTF-8 JSON claims 加应用专属 domain separator 签名；claims 包含 artifactSha256，必须与附带的原始观测数据字节核对，不能仅验证摘要字符串形状。

    trusted control plane: pinned Ed25519 key + release/host/ns + nonce
             ↓
    signed canonical UTF-8 claims + Ed25519 signature
             ↓                              raw collector bytes
    signature verification → release/host/ns/nonce/time → SHA-256 equality
             ↓
    ready_for_isolated_attestation_binding_test
             ↓ publishAuthorized=false

代码：src/runtime/recovery-writer-collector-attestation.ts。
测试：src/demos/day87-morning-collector-attestation-test.ts。
命令：npm run test:recovery-writer-collector-attestation。

负向回归覆盖签名篡改、错 keyId、错误私钥、release/host/namespace 错绑、错 challenge、时间过期、原始字节被替换、非规范 JSON、未知版本。测试使用进程内生成的临时 Ed25519 密钥，永不提交私钥。

## 必须区分的两类证明

签名可以证明“对应私钥持有者签过这些字节”，不能证明“字节忠实反映了真实内核”。生产还需要受信采集代理、主机工作负载身份、控制面密钥签发和吊销、一次性挑战持久消费、可信时间、真实 /proc 与挂载命名空间观测及原始审计日志。Day 86 的七项 OS 隔离证据并未因为新增签名而自动完成。

12:00 承接 Day 86 /proc 临时夹具，真正签署观测字节；18:00 处理重放、密钥轮换与证据失效。Day 87 不做阶段总结。
