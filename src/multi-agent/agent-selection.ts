import { getAgentDescriptor, listAgentDescriptors } from "./agent-registry.js";

export interface AgentSelection {
  agentId: string;
  reason: string;
}

export interface AgentSelectionContext {
  goal: string;
}

export function buildAgentSelectionContext(
  goal: string
): AgentSelectionContext {
  return { goal };
}

export function listRoutableAgents() {
  return listAgentDescriptors().filter(agent => agent.id !== "coordinator");
}

export function validateAgentSelection(
  value: unknown
): AgentSelection {
  if (typeof value !== "object" || value === null) {
    throw new Error("Agent selection must be an object");
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.agentId !== "string" || !candidate.agentId.trim()) {
    throw new Error("Agent selection.agentId is required");
  }

  if (typeof candidate.reason !== "string" || !candidate.reason.trim()) {
    throw new Error("Agent selection.reason is required");
  }

  const agent = getAgentDescriptor(candidate.agentId);

  if (!agent || agent.id === "coordinator") {
    throw new Error(`Unknown or non-routable agent: ${candidate.agentId}`);
  }

  return {
    agentId: candidate.agentId,
    reason: candidate.reason
  };
}
