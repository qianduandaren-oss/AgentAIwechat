# Day 18 Morning — Secrets / PII / Data Leakage

Agent security is not only about preventing unauthorized actions. The runtime must also prevent sensitive data from being unnecessarily copied into prompts, memory, RAG context, traces, audit logs, and tool results.

## Data classes

- `secret`: API keys, access tokens, passwords, authorization headers. These should normally never enter an LLM context or persistent log.
- `pii`: phone numbers, identity information, email addresses and other personally identifiable information. Use only when the task requires it and prefer masking/minimization.
- `business_sensitive`: customer notes, internal pricing, contracts and other restricted business data. Access should follow authorization scope and least-data principles.

## Runtime principle

```text
Authorized to access
        !=
Safe to send to the LLM
        !=
Safe to persist in logs
```

Treat each boundary independently:

```text
Business System
  -> Resource Authorization
  -> Data Minimization / Redaction
  -> LLM Context
  -> Output Filtering
  -> Trace / Audit Sanitization
```

`src/security/sensitive-data.ts` provides the first reusable redaction primitives for later integration into tool results, traces and audit events.
