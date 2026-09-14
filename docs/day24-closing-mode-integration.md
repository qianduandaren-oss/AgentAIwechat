# Day 24 Noon — Closing Mode Integration

The production agent loop now converts a soft budget warning into a controlled closing phase instead of throwing immediately.

## Runtime behavior

- Normal turns expose registered tools.
- When budget policy enters `warning` and extra retrieval is disabled, pending tool calls are not executed.
- The runtime makes one `agent_finalize` LLM call with `tools: []`.
- Existing messages and prior tool observations are preserved for the final answer.
- A truly exhausted hard budget is not bypassed.

## Integration coverage

`src/demos/production-runtime-integration-test.ts` now verifies that closing mode:

1. returns a completed result;
2. does not execute the new tool call that triggered warning;
3. makes exactly one final model call;
4. uses the `agent_finalize` task with tools disabled;
5. keeps prior tool observations in final-call context.

Run with:

```bash
npm run test:runtime-integration
```
