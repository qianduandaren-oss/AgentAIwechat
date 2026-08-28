import { runPlanner } from "../planning/run-planner.js";

async function main(): Promise<void> {
  await runPlanner(
    "分析张三为什么没有报名，并给出下一步跟进建议"
  );
}

main().catch(console.error);
