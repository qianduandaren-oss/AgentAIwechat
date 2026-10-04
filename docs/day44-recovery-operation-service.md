# Day 44 Noon · Recovery Operation Service

Human recovery submits an operation intent instead of invoking a business Tool directly.

The first command set is deliberately small: `retry_recovery`, `reconcile_again`, and `quarantine`.

Both retry and reconcile commands re-enter `CheckpointRecoveryCoordinator`; they do not call `ToolExecutor` directly. Existing `RecoveryPlanner`, `ToolEffectPolicy`, `Reconciler`, and CAS rules still decide whether the next safe action is retry, reconcile, skip, or suspend.

The service checks the operator's expected checkpoint version before acting. A stale operator page must not silently mutate a newer Run.

```text
Operator
↓
RecoveryOperationCommand
↓
Authorization
↓
load latest checkpoint
↓
expectedVersion check
↓
Operational control check
↓
CheckpointRecoveryCoordinator
↓
RecoveryPlanner / Reconciler / CAS
↓
Audit
```

`quarantine` is modeled separately from `ResumeBoundary`. Runtime position and operational permission are different dimensions.

```text
boundary = reconciling_tool
operationalStatus = quarantined
```

The first implementation uses an in-memory control store for the learning Runtime. A production adapter should persist this operational state.

Security note: audit is part of the manual-operation control path, not best-effort observability. If audit cannot be written, the service must not pretend the human operation was safely recorded.
