import type { AgentTrajectory, TrajectoryExpectation } from "./trajectory-types.js";

export interface TrajectoryEvalResult {
  passed: boolean;
  violations: string[];
  usedTools: string[];
  totalSteps: number;
}

export function evaluateTrajectory(
  trajectory: AgentTrajectory,
  expectation: TrajectoryExpectation
): TrajectoryEvalResult {
  const usedTools = trajectory.events
    .filter(event => event.type === "tool_call" && event.name)
    .map(event => event.name as string);

  const violations: string[] = [];

  for (const tool of expectation.requiredTools ?? []) {
    if (!usedTools.includes(tool)) {
      violations.push(`missing required tool: ${tool}`);
    }
  }

  for (const tool of expectation.forbiddenTools ?? []) {
    if (usedTools.includes(tool)) {
      violations.push(`used forbidden tool: ${tool}`);
    }
  }

  if (
    expectation.maxSteps !== undefined &&
    trajectory.totalSteps > expectation.maxSteps
  ) {
    violations.push(
      `too many steps: ${trajectory.totalSteps} > ${expectation.maxSteps}`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
    usedTools,
    totalSteps: trajectory.totalSteps
  };
}
