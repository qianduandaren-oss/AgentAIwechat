# Day 17 Evening: Prompt Injection Defense in Depth

Prompt injection is not solved by keyword filters or prompt wording alone. Treat user input, RAG documents, web pages and tool results as untrusted data, preserve provenance, and keep deterministic security controls outside the LLM.

Defense layers:

1. Trust boundary and provenance.
2. Guarded context packaging.
3. Least-privilege tool exposure.
4. Deterministic authorization.
5. Human approval for risky side effects.
6. Audit and tracing.

Security objective: do not assume the model can never be influenced; constrain the impact when it is influenced.

Run the Day 17 demo after building:

```bash
npm run build
npm run demo:prompt-injection
```
