# Day 22 Evening — HTTP Adapter Contract

`ProductionAgentRuntime.runStructured()` is the stable runtime boundary. HTTP, CLI, and worker adapters should depend on this structured result instead of parsing thrown error messages.

Current HTTP mapping:

- `completed` → 200
- `permission_denied` → 403
- `deadline_exceeded` → 504
- `runtime_error` → 500
- `budget_warning` / `budget_exceeded` / `max_steps_reached` → 200 with structured `stopReason`

Budget and max-step stops are treated as valid Agent-run outcomes rather than HTTP transport failures. Clients should branch on `body.stopReason`.

The adapter deliberately contains no Agent reasoning, security policy, or budget logic. Those remain inside `ProductionAgentRuntime`.