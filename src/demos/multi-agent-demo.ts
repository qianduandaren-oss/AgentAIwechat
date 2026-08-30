import { runCoordinator } from "../multi-agent/coordinator.js";

async function main() {
  const state = await runCoordinator(
    "分析张三为什么没有报名",
    "C001"
  );

  console.log(JSON.stringify(state, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
