export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolSideEffect = "none" | "reversible" | "irreversible";
export type PermissionStatus = "allowed" | "approval_required" | "denied";

export interface ToolPermissionRule {
  toolName: string;
  riskLevel: ToolRiskLevel;
  sideEffect: ToolSideEffect;
  requiresApproval: boolean;
  enabled?: boolean;
}

export interface PermissionDecision {
  status: PermissionStatus;
  rule: ToolPermissionRule;
  reason: string;
}

export const DEFAULT_TOOL_PERMISSION_RULES: ToolPermissionRule[] = [
  { toolName: "search_customer", riskLevel: "low", sideEffect: "none", requiresApproval: false },
  { toolName: "search_chat_history", riskLevel: "low", sideEffect: "none", requiresApproval: false },
  { toolName: "search_knowledge", riskLevel: "low", sideEffect: "none", requiresApproval: false },
  { toolName: "create_reminder", riskLevel: "medium", sideEffect: "reversible", requiresApproval: false },
  { toolName: "send_message", riskLevel: "high", sideEffect: "irreversible", requiresApproval: true },
  { toolName: "update_customer", riskLevel: "high", sideEffect: "reversible", requiresApproval: true },
  { toolName: "execute_refund", riskLevel: "high", sideEffect: "irreversible", requiresApproval: true }
];

const fallbackRule: ToolPermissionRule = {
  toolName: "*",
  riskLevel: "high",
  sideEffect: "irreversible",
  requiresApproval: true
};

export function decideToolPermission(
  toolName: string,
  rules: ToolPermissionRule[] = DEFAULT_TOOL_PERMISSION_RULES
): PermissionDecision {
  const rule = rules.find(item => item.toolName === toolName) ?? {
    ...fallbackRule,
    toolName
  };

  if (rule.enabled === false) {
    return { status: "denied", rule, reason: "tool_disabled" };
  }
  if (rule.requiresApproval) {
    return { status: "approval_required", rule, reason: "high_risk_action_requires_human_approval" };
  }
  return { status: "allowed", rule, reason: "permission_policy_allowed" };
}
