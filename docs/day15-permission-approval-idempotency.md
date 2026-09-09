# Day 15：Permission / Human Approval / Idempotency

Agent 会调用 Tool 以后，不能把所有 Tool 都当成同一种风险。查询客户和真正给客户发消息，工程上必须走两条不同的路径。

## 代码位置

```text
src/security/tool-permission.ts
src/security/approval-store.ts
src/security/idempotency.ts
src/security/secure-tool-executor.ts
src/tools/executor.ts
src/demos/day15-permission-approval-demo.ts
```

## 主链

```text
Tool Call
  ↓
Permission Policy
  ├─ low risk / no side effect → allowed
  ├─ disabled → denied
  └─ high risk / side effect → PendingAction
                               ↓
                         Human Approval
                          ├─ reject → stop
                          └─ approve
                               ↓
                         Idempotency Guard
                          ├─ executed → return cached result
                          └─ new action
                               ↓
                           Tool Execute
                               ↓
                              Audit
```

`PendingAction` 会冻结当时的 Tool 名称和参数。批准的是这一份动作快照，而不是让模型在审批后重新生成一组参数。

`SecureToolExecutor` 已继续复用 Day 16 的 Authorization 与 Audit：Permission 回答“这个动作风险多大”，Authorization 回答“这个人/Agent 是否有权做”，Approval 回答“这一次高风险动作是否有人批准”，Idempotency 保证批准后的副作用只发生一次。

## Demo

```bash
npm run build
node dist/demos/day15-permission-approval-demo.js
```

Demo 会经历：

```text
pending_approval
→ manager approve
→ executed / fromCache=false
→ repeat
→ executed / fromCache=true
```
