export type AgentRole =
  | "coordinator"
  | "customer_analysis"
  | "copywriting";

export interface AgentDescriptor {
  id: string;
  role: AgentRole;
  description: string;
  allowedTools: string[];
}

export interface DelegationTask<TInput = unknown> {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  goal: string;
  input: TInput;
}

export interface DelegationResult<TOutput = unknown> {
  taskId: string;
  agentId: string;
  success: boolean;
  output?: TOutput;
  error?: string;
}
