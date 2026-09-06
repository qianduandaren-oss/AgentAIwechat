# Agent AI 工程师 · Day 16 晚练

## Authorization Audit Trail：权限系统不仅要会拒绝，还要能说明“谁对什么做了什么”

日期：2026-09-06

Day 16 早课把权限从 Tool-level Permission 推进到 Context-aware Authorization，午练又把 RBAC + ABAC 串成 `authorize({ actor, agent, action, resource })`。今晚收口最后一层：Audit Trail。

核心边界：Trace 回答“系统怎么跑的”，Audit 回答“谁在什么时候，通过哪个 Agent，尝试对哪个资源做什么，结果如何”。

推荐链路：

```text
Tool Call
  ↓
Permission Policy
  ↓
Authorization
  ↓
Audit Decision
  ↓
Approval / Execute
  ↓
Audit Outcome
```

本次仓库新增 `authorization-types.ts`、`authorization-service.ts`、`audit-log.ts` 与 `authorization-audit-demo.ts`。Demo 覆盖同部门销售允许、跨部门销售拒绝、同区域经理跨部门允许三个 Case，并把授权决策写入内存 Audit Sink。

运行：

```bash
npm run build
npm run demo:authorization-audit
```

后续应继续把这条安全链接入真实 `agent-loop.ts` 与 Tool Executor，并补齐 Day 13–15 尚未落库的 Trace、Cost、Permission、Approval 模块，避免课程与代码仓继续脱节。
