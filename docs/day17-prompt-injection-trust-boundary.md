# Day 17 Morning: Prompt Injection Trust Boundary

Prompt Injection 的核心工程问题不是“模型会不会听坏话”，而是 Runtime 有没有把不可信数据误当成指令。

## 信任边界

```text
Trusted Instructions
- system policy
- developer/runtime policy

Untrusted Data
- user input
- RAG documents
- web pages
- tool results
```

原则：不可信内容可以作为事实、证据和业务数据进入上下文，但不能因此获得修改系统策略、提升权限、绕过 Authorization 或触发高风险 Tool 的资格。

推荐执行链：

```text
Untrusted Content
  -> classify source/trust
  -> retrieve/parse as data
  -> LLM proposes action
  -> Permission
  -> Authorization
  -> Approval if required
  -> Tool execution
```

`src/security/trust-boundary.ts` 提供第一版内容来源与信任级别类型。后续午练会继续增加可疑指令检测、上下文封装和测试案例，并接入 Agent Runtime。
