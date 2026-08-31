import { MockLLMProvider } from "../llm/providers/mock-provider.js";
import { runCoordinator } from "../multi-agent/coordinator.js";
import { delegate } from "../multi-agent/delegation-runtime.js";
import { selectAgent } from "../multi-agent/agent-router.js";

async function main() {
  const provider = new MockLLMProvider();

  const analysisSelection = await selectAgent(provider, "分析张三为什么没有报名");
  const copySelection = await selectAgent(provider, "根据已知客户情况生成一条跟进文案草稿");

  console.log("\nRouting evaluation:");
  console.log(JSON.stringify({ analysisSelection, copySelection }, null, 2));

  const state = await runCoordinator(provider, "分析张三为什么没有报名", "C001");
  console.log("\nDynamic routing + allowed delegation:");
  console.log(JSON.stringify(state, null, 2));

  const copyResult = await delegate({
    id: "task-copy",
    fromAgentId: "coordinator",
    toAgentId: copySelection.agentId,
    goal: "根据已知客户情况生成一条跟进文案草稿",
    input: { customerId: "C001", brief: "周末班安排" }
  });
  console.log("\nCopywriting delegation:");
  console.log(JSON.stringify(copyResult, null, 2));

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
