# Day 28 Noon — Runtime Readiness Validation

ProductionAgentRuntime now validates deployment-critical configuration at construction time and exposes a `readiness()` report.

Checks include: non-empty provider/model, no mock provider in production, sensible timeout, model-call budget not lower than max steps, and a minimum token budget.

Files:
- `src/runtime/readiness.ts`
- `src/runtime/production-runtime.ts`
- `src/demos/readiness-integration-test.ts`

Run: `npm run test:readiness`

This is a deployment boundary, not a network health endpoint yet. Provider reachability and external dependencies should be added as separate readiness probes rather than hidden inside static config validation.
