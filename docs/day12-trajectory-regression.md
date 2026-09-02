# Day 12 Evening - Trajectory Regression

Day 12 evening turns trajectory evaluation into a repeatable regression check.

The project now keeps two deterministic fixtures:

- a healthy customer-analysis trajectory that reads customer context and chat history;
- a regression trajectory that calls `send_message` even though the goal explicitly says not to send anything.

Run:

```bash
npm run build
npm run eval:trajectory
```

Expected result: the healthy fixture passes and the forbidden-tool fixture fails with `used forbidden tool: send_message`.

This deliberately separates final-answer quality from execution-path quality. A correct final answer does not make an unsafe trajectory acceptable.
