# Week 7 · Day 43–49 Checkpoint

Date: 2026-10-09 (Asia/Shanghai)

## Verified on main

`main` reached Day 47 noon (`53a14a99637520338d167857c1317cb3b01c3b38`) when this checkpoint was prepared.
Available: durable recovery command identity and terminal replay, Recovery Planner/Reconciler, transition committer, SQLite recovery finalization and outbox abstractions.

## Not yet integrated

- Day 47 evening: crash-safe in-flight Resumer; do not re-run side-effect handlers blindly.
- Day 48: causedByCommandId support and control-only recovery decision policy.
- Day 49: control-only SQLite UoW with checkpoint read-only version guard and atomic Control + Command + Outbox.
- Replace non-transactional RecoveryOperationService write path.
- Run full repository build and SQLite fault-injection tests after integrating.

## Integration gates for Day 50 onward

1. Preserve the existing runtime interfaces, source files and schema.
2. Add optional causation fields with backward compatibility and unit tests.
3. Add pure control-only policy before changing execution paths.
4. Add control-only UoW and fault-injection cases; ensure no pointless Checkpoint version bump.
5. Integrate Resumer only after Command/Control/Outbox atomic commit is reliable.
6. Prove `npm run build` and the repository's runtime test suite pass; only then claim GitHub CI green.

Do not confuse local test stubs or course diagrams with verified integration.
