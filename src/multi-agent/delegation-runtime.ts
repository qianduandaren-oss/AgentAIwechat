import type { DelegationTask, DelegationResult } from "./types.js";
import {
  runCustomerAnalysisAgent,
  type CustomerAnalysisInput,
  type CustomerAnalysisOutput
} from "./customer-analysis-agent.js";
import {
  runCopywritingAgent,
  type CopywritingInput,
  type CopywritingOutput
} from "./copywriting-agent.js";
import { checkDelegation } from "./delegation-guard.js";

export async function delegate(
  task: DelegationTask
): Promise<DelegationResult> {
  const guard = checkDelegation(task);

  if (!guard.allowed) {
    return {
      taskId: task.id,
      agentId: task.toAgentId,
      success: false,
      error: guard.reason ?? "Delegation rejected"
    };
  }

  switch (task.toAgentId) {
    case "customer-analysis":
      return runCustomerAnalysisAgent(
        task as DelegationTask<CustomerAnalysisInput>
      ) as Promise<DelegationResult<CustomerAnalysisOutput>>;
    case "copywriting":
      return runCopywritingAgent(
        task as DelegationTask<CopywritingInput>
      ) as Promise<DelegationResult<CopywritingOutput>>;
    default:
      return {
        taskId: task.id,
        agentId: task.toAgentId,
        success: false,
        error: `No runtime registered for agent: ${task.toAgentId}`
      };
  }
}
