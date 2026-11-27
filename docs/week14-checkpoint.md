# Week 14 / Day 92–98 checkpoint (2026-11-27)

| Day | Actual course/project topic |
| --- | --- |
| 92 | Canonical inventory digest, SQLite unique freeze, replay and version/digest CAS invalidation |
| 93 | Independent candidate audit checkpoint, append-only sequence/hash CAS and same-domain double rollback limitation |
| 94 | Challenge-bound Ed25519 gateway, pinned peer/SPKI and high-watermark verification |
| 95 | Key lifecycle, policy double-read and revocation/rotation races |
| 96 | SQLite conditional capability issuance, revocation, resource fencing, atomic simulated effects and replay |
| 97 | Separate controller/resource databases, persisted commands, ACK replay, partial revocation and prior effects |
| 98 | In-flight candidate receipt classification, same-journal ordering and read-only release composition |

Project: existing Recovery Runtime under src/runtime; runnable fixture tests under src/demos, npm scripts and runtime-tests CI. Day 98 composition retains prior blockers; candidate evidence is untrusted and publishAuthorized remains false. No production authority; CI status of the new changes has not yet been verified.

Strengthen authoritative inventory, durable resource journal/no-rollback roots, authenticated receipts and finality, and explicit recovery authority. Day 99–105 proposed path: evidence ingestion boundary; authorized historical archive; durable resource journal; provider receipt contracts; reconciliation work queue; bounded recovery/observability; fault-injection acceptance. No real provider calls or release before the independent evidence and resource enforcement contracts are met.

## Copyable checkpoint

已完成 Day 98（Week 14，Day 92–98）。本周沿 Recovery Runtime 完成 Inventory 冻结与 CAS、审计水位与双回滚分析、Challenge/Ed25519 验签、密钥撤销双读、SQLite 原子授权与 fencing、跨域撤销屏障，以及在途副作用分类和只读组合诊断。代码集中在 src/runtime，测试在 src/demos；候选证据均不可信，UNKNOWN 不重发，生产保持 NO_GO。下一阶段从 Day 99 的当前授权历史证据归档入口开始，逐步补资源持久日志、认证回执、对账队列和故障验收。从 Day 99 继续，不重复前面内容。
