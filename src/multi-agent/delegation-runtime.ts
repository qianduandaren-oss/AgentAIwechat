import type { DelegationTask, DelegationResult } from "./types.js";
import {
  runCustomerAnalysisAgent,
  type CustomerAnalysisInput,
  type CustomerAnalysisOutput
} from "./customer-analysis-agent.js";

export async function delegate(
  task: DelegationTask
): Promise<DelegationResult> {
  switch (task.toAgentId) {
    case "customer-analysis":
      return runCustomerAnalysisAgent(
        task as DelegationTask<CustomerAnalysisInput>
      ) as Promise<DelegationResult<CustomerAnalysisOutput>>;

    default:
      return {
        taskId: task.id,
        agentId: task.toAgentId,
        success: false,
        error: `Unknown agent: ${task.toAgentId}`
      };
  }
}
