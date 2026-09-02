# Day 12 Morning — Trajectory Evaluation

Routing Evaluation answers whether the coordinator selected the right agent. Trajectory Evaluation goes one level deeper: it checks whether an agent reached its result through an acceptable execution path.

A trajectory records meaningful runtime events such as LLM turns, tool calls, tool results, and the final answer. The first evaluation contract lives in `src/evaluation/trajectory-types.ts` and supports expectations for required tools, forbidden tools, and maximum steps.

The current `runAgentLoop()` already contains the information needed to build a trajectory: every loop step, every extracted tool call, every tool result, and the final response. The next exercise will instrument that loop without changing its decision semantics, then add a deterministic evaluator over the captured trajectory.

Key rule: final-answer correctness and trajectory quality are separate dimensions. A correct answer reached through a forbidden write tool, unnecessary repeated calls, or excessive steps is still an agent-quality failure.
