import type { DelegationTask } from "./types.js";
import { getAgentDescriptor } from "./agent-registry.js";

export interface DelegationGuardResult {
  allowed: boolean;
  reason?: string;
}

const delegationPolicy: Record<string, string[]> = {
  coordinator: ["customer-analysis"]
};

export function checkDelegation(
  task: DelegationTask
): DelegationGuardResult {
  const fromAgent = getAgentDescriptor(task.fromAgentId);
  const toAgent = getAgentDescriptor(task.toAgentId);

  if (!fromAgent) {
    return {
      allowed: false,
      reason: `Unknown source agent: ${task.fromAgentId}`
    };
  }

  if (!toAgent) {
    return {
      allowed: false,
      reason: `Unknown target agent: ${task.toAgentId}`
    };
  }

  const allowedTargets = delegationPolicy[task.fromAgentId] ?? [];

  if (!allowedTargets.includes(task.toAgentId)) {
    return {
      allowed: false,
      reason: `${task.fromAgentId} cannot delegate to ${task.toAgentId}`
    };
  }

  return { allowed: true };
}

export function canAgentUseTool(
  agentId: string,
  toolName: string
): boolean {
  const descriptor = getAgentDescriptor(agentId);
  return descriptor?.allowedTools.includes(toolName) ?? false;
}
