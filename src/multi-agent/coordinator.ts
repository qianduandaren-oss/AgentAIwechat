import type { DelegationResult, DelegationTask } from "./types.js";
import {
  type CustomerAnalysisInput,
  type CustomerAnalysisOutput
} from "./customer-analysis-agent.js";
import { delegate } from "./delegation-runtime.js";

export interface CoordinatorState {
  goal: string;
  delegations: DelegationResult[];
}

export async function runCoordinator(
  goal: string,
  customerId: string
): Promise<CoordinatorState> {
  const state: CoordinatorState = {
    goal,
    delegations: []
  };

  const task: DelegationTask<CustomerAnalysisInput> = {
    id: `task-${Date.now()}`,
    fromAgentId: "coordinator",
    toAgentId: "customer-analysis",
    goal: "分析客户没有报名的核心异议，并返回证据",
    input: { customerId }
  };

  const result = await delegate(task) as DelegationResult<CustomerAnalysisOutput>;
  state.delegations.push(result);

  if (!result.success) {
    throw new Error(result.error ?? "Delegation failed");
  }

  return state;
}
