export type Actor = {
  id: string;
  roles: string[];
  departmentId?: string;
  regionId?: string;
};

export type Resource = {
  id: string;
  type: string;
  ownerId?: string;
  departmentId?: string;
  regionId?: string;
  sensitivity?: "normal" | "vip";
};

export type AuthorizationRequest = {
  actor: Actor;
  agentId: string;
  action: string;
  resource: Resource;
};

export type AuthorizationReason =
  | "allowed"
  | "agent_denied"
  | "role_denied"
  | "resource_denied";

export type AuthorizationDecision = {
  allowed: boolean;
  reason: AuthorizationReason;
  policy: string;
};
