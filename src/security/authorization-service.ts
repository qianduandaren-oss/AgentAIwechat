import type {
  Actor,
  AuthorizationDecision,
  AuthorizationRequest,
  Resource
} from "./authorization-types.js";

const rolePermissions: Record<string, string[]> = {
  sales: ["customer.read"],
  manager: ["customer.read", "customer.update"],
  regional_manager: [
    "customer.read",
    "customer.update",
    "customer.read.cross_department"
  ],
  finance: ["refund.read", "refund.execute"]
};

const agentPermissions: Record<string, string[]> = {
  sales_agent: ["customer.read", "customer.update"],
  finance_agent: ["refund.read", "refund.execute"]
};

function hasRolePermission(actor: Actor, action: string): boolean {
  return actor.roles.some(role => rolePermissions[role]?.includes(action));
}

function canAgentPerform(agentId: string, action: string): boolean {
  return agentPermissions[agentId]?.includes(action) ?? false;
}

function canAccessResource(actor: Actor, action: string, resource: Resource): boolean {
  if (resource.sensitivity === "vip" && !actor.roles.includes("manager")) {
    return false;
  }

  if (!action.startsWith("customer.")) {
    return true;
  }

  if (actor.roles.includes("regional_manager")) {
    return Boolean(actor.regionId && actor.regionId === resource.regionId);
  }

  if (actor.roles.includes("manager") || actor.roles.includes("sales")) {
    return Boolean(actor.departmentId && actor.departmentId === resource.departmentId);
  }

  return false;
}

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  if (!canAgentPerform(request.agentId, request.action)) {
    return { allowed: false, reason: "agent_denied", policy: "agent.capability" };
  }

  if (!hasRolePermission(request.actor, request.action)) {
    return { allowed: false, reason: "role_denied", policy: "rbac.role_permission" };
  }

  if (!canAccessResource(request.actor, request.action, request.resource)) {
    return { allowed: false, reason: "resource_denied", policy: "abac.resource_scope" };
  }

  return { allowed: true, reason: "allowed", policy: "authorization.combined" };
}
