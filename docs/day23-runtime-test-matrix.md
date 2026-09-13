# Day 23 Runtime Test Matrix

## Test layers

| Capability | Unit | Contract | Integration | Smoke |
| --- | --- | --- | --- | --- |
| Token / cost calculation | Yes | - | Via runtime budget | Optional |
| Error → StopReason | - | Yes | Via runStructured | - |
| StopReason → HTTP status | - | Yes | Adapter integration later | - |
| Completed run | - | Contract shape | Yes | Yes |
| Model-call budget | Budget class | StopReason | Yes | Optional |
| Timeout | Timeout helper | StopReason | Yes | Optional |
| Permission denial | Permission policy | StopReason | Next | Optional |
| Real provider connectivity | - | - | - | Yes |

## Current automated path

```text
push / pull_request
        ↓
GitHub Actions
        ↓
npm ci
        ↓
npm run build
        ↓
Runtime Contract Checks
        ↓
Production Runtime Integration Checks
```

The CI path intentionally uses controllable providers and does not require API keys. Real-provider checks should remain a separate smoke-test layer so normal pull requests stay deterministic.

## Next gaps

1. Add a permission-denied integration case through SecureToolExecutor rather than throwing a fake error.
2. Add closing-mode behavior after a budget warning.
3. Add a small real-provider smoke test only when a secure CI credential strategy is available.
