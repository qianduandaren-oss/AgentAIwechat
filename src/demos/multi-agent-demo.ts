import { runCoordinator } from "../multi-agent/coordinator.js";
import { delegate } from "../multi-agent/delegation-runtime.js";

async function main() {
  const state = await runCoordinator(
    "分析张三为什么没有报名",
    "C001"
  );

  console.log("\nAllowed delegation:");
  console.log(JSON.stringify(state, null, 2));

  const rejected = await delegate({
    id: "task-rejected",
    fromAgentId: "customer-analysis",
    toAgentId: "coordinator",
    goal: "尝试反向委派给 coordinator",
    input: {}
  });

  console.log("\nRejected delegation:");
  console.log(JSON.stringify(rejected, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
