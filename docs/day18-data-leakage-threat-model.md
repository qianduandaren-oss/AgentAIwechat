# Day 18：Data Leakage Threat Model

Agent 的敏感数据风险不只发生在最终回答，而是发生在数据被复制到不同边界的全过程。

```text
Raw Tool Result
├── LLM Context → task-specific projection
├── Memory      → only durable facts needed later
├── Trace       → sanitized operational metadata
└── Audit       → minimal security facts
```

核心原则：Authorized to access != Safe to send to LLM != Safe to persist.

## 六个重点出口

1. Prompt：只投影任务需要字段，不直接 JSON.stringify(rawToolResult)。
2. Memory：不要把完整 Prompt / Tool Result 当长期记忆保存。
3. RAG：入库前做数据分类，检索后仍按当前 Actor 权限过滤。
4. Tool Result：先 Projection，再进入模型；Secret 保留在 Runtime。
5. Trace：记录运行元数据，敏感对象先 sanitize。
6. Audit：记录 actor/action/resource/outcome 等最小事实，不做业务数据备份。

## 当前实现

- `src/security/sensitive-data.ts`：Mask / Redact / Log Sanitization
- `src/security/safe-tool-result.ts`：LLM DTO Projection
- `src/security/data-leakage-policy.ts`：按 LLM / Memory / Trace / Audit 边界构造不同 Payload
- `src/demos/safe-tool-result-demo.ts`
- `src/demos/data-leakage-boundary-demo.ts`

运行：

```bash
npm run build
npm run demo:safe-tool-result
npm run demo:data-leakage
```
