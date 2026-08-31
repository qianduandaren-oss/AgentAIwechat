import type { LLMProvider } from "../llm/types.js";
import type { DelegationResult, DelegationTask } from "./types.js";
import {
  type CustomerAnalysisInput,
  type CustomerAnalysisOutput
} from "./customer-analysis-agent.js";
import { selectAgent } from "./agent-router.js";
import { delegate } from "./delegation-runtime.js";

export interface CoordinatorState {
  goal: string;
  selections: Array<{
    agentId: string;
    reason: string;
  }>;
  delegations: DelegationResult[];
}

export async function runCoordinator(
  provider: LLMProvider,
  goal: string,
  customerId: string
): Promise<CoordinatorState> {
  const state: CoordinatorState = {
    goal,
    selections: [],
    delegations: []
  };

  const selection = await selectAgent(provider, goal);
  state.selections.push(selection);

  const task: DelegationTask<CustomerAnalysisInput> = {
    id: `task-${Date.now()}`,
    fromAgentId: "coordinator",
    toAgentId: selection.agentId,
    goal,
    input: { customerId }
  };

  const result = await delegate(task) as DelegationResult<CustomerAnalysisOutput>;
  state.delegations.push(result);

  if (!result.success) {
    throw new Error(result.error ?? "Delegation failed");
  }

  return state;
}
