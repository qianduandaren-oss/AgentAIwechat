import { trajectoryFixtures } from "../evaluation/trajectory-cases.js";
import { evaluateTrajectory } from "../evaluation/trajectory-evaluator.js";

for (const fixture of trajectoryFixtures) {
  const result = evaluateTrajectory(
    fixture.trajectory,
    fixture.case.expectation
  );

  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${fixture.case.id} | steps=${result.totalSteps} | tools=${result.usedTools.join(",") || "<none>"}`
  );

  for (const violation of result.violations) {
    console.log(`  - ${violation}`);
  }
}
