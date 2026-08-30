import type { DelegationTask, DelegationResult } from "./types.js";

export interface CustomerAnalysisInput {
  customerId: string;
}

export interface CustomerAnalysisOutput {
  customerId: string;
  concern: string;
  confidence: number;
  evidence: string[];
}

export async function runCustomerAnalysisAgent(
  task: DelegationTask<CustomerAnalysisInput>
): Promise<DelegationResult<CustomerAnalysisOutput>> {
  if (!task.input.customerId) {
    return {
      taskId: task.id,
      agentId: task.toAgentId,
      success: false,
      error: "customerId is required"
    };
  }

  // Day 9 keeps the sub-agent deterministic so we can first make the
  // delegation protocol testable. A later lesson can replace this body
  // with the existing Planner/Tool runtime without changing the protocol.
  return {
    taskId: task.id,
    agentId: task.toAgentId,
    success: true,
    output: {
      customerId: task.input.customerId,
      concern: "weekend_schedule",
      confidence: 0.91,
      evidence: ["客户多次询问周末班和上课时间"]
    }
  };
}
