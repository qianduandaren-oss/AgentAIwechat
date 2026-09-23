# Day 33 Evening — Shutdown Failure / Escalation Policy

Day 33 adds a host-level escalation policy on top of `runShutdownWithDeadline()`.

- `completed`: log success; do not set a failure exit code.
- `failed`: set `process.exitCode = 1`, log the original error.
- `deadline_exceeded`: set `process.exitCode = 1`, log that the host waiting budget was exhausted, but explicitly preserve the fact that the underlying shutdown may still be running.

The policy deliberately does **not** call `process.exit()` and does **not** claim to cancel running Agent work. End-to-end cancellation still requires AbortSignal propagation through Agent Loop, LLM Provider and Tool Execution.

Run the check with `npm run test:shutdown-escalation`.
