import type { AgentToolCall } from "../llm/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  ApprovalStore,
  type PendingAction
} from "./approval-store.js";
import {
  createAuditEvent,
  InMemoryAuditSink,
  type AuditSink
} from "./audit-log.js";
import { authorize } from "./authorization-service.js";
import type { Actor, Resource } from "./authorization-types.js";
import {
  createIdempotencyKey,
  IdempotencyStore
} from "./idempotency.js";
import {
  DEFAULT_TOOL_PERMISSION_RULES,
  decideToolPermission,
  type PermissionDecision,
  type ToolPermissionRule
} from "./tool-permission.js";

export type SecureToolExecutionResult =
  | {
      status: "executed";
      result: unknown;
      idempotencyKey: string;
      fromCache: boolean;
    }
  | {
      status: "pending_approval";
      action: PendingAction;
      permission: PermissionDecision;
    }
  | {
      status: "denied";
      reason: string;
      permission?: PermissionDecision;
    };

export interface ToolAuthorizationContext {
  actor: Actor;
  agentId: string;
  actionResolver?: (toolCall: AgentToolCall) => string;
  resourceResolver?: (toolCall: AgentToolCall) => Resource;
}

export interface SecureToolExecutorOptions {
  permissionRules?: ToolPermissionRule[];
  approvalStore?: ApprovalStore;
  idempotencyStore?: IdempotencyStore;
  authorization?: ToolAuthorizationContext;
  auditSink?: AuditSink;
  traceId?: string;
}

function defaultActionResolver(toolCall: AgentToolCall): string {
  const mapping: Record<string, string> = {
    search_customer: "customer.read",
    search_chat_history: "customer.read",
    update_customer: "customer.update",
    send_message: "customer.update",
    execute_refund: "refund.execute"
  };
  return mapping[toolCall.name] ?? toolCall.name;
}

function defaultResourceResolver(toolCall: AgentToolCall): Resource {
  const args = toolCall.arguments;
  const id = String(args.customerId ?? args.resourceId ?? args.id ?? "global");
  const type = toolCall.name.includes("refund") ? "refund" : "customer";
  return {
    id,
    type,
    departmentId: typeof args.departmentId === "string" ? args.departmentId : undefined,
    regionId: typeof args.regionId === "string" ? args.regionId : undefined,
    sensitivity: args.sensitivity === "vip" ? "vip" : "normal"
  };
}

function sameToolCall(a: AgentToolCall, b: AgentToolCall): boolean {
  return a.name === b.name && JSON.stringify(a.arguments) === JSON.stringify(b.arguments);
}

export class SecureToolExecutor {
  readonly approvalStore: ApprovalStore;
  readonly idempotencyStore: IdempotencyStore;
  readonly auditSink: AuditSink;
  private readonly permissionRules: ToolPermissionRule[];

  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: SecureToolExecutorOptions = {}
  ) {
    this.permissionRules = options.permissionRules ?? DEFAULT_TOOL_PERMISSION_RULES;
    this.approvalStore = options.approvalStore ?? new ApprovalStore();
    this.idempotencyStore = options.idempotencyStore ?? new IdempotencyStore();
    this.auditSink = options.auditSink ?? new InMemoryAuditSink();
  }

  async execute(
    toolCall: AgentToolCall,
    approvedActionId?: string
  ): Promise<SecureToolExecutionResult> {
    const permission = decideToolPermission(toolCall.name, this.permissionRules);
    if (permission.status === "denied") {
      await this.audit(toolCall, "denied", permission.reason);
      return { status: "denied", reason: permission.reason, permission };
    }

    const authorizationDecision = this.checkAuthorization(toolCall);
    if (authorizationDecision && !authorizationDecision.allowed) {
      await this.audit(
        toolCall,
        "denied",
        authorizationDecision.reason,
        authorizationDecision.policy
      );
      return {
        status: "denied",
        reason: `authorization:${authorizationDecision.reason}`,
        permission
      };
    }

    let action: PendingAction | undefined;
    if (permission.status === "approval_required") {
      if (!approvedActionId) {
        action = this.approvalStore.create(toolCall);
        await this.audit(toolCall, "allowed", "pending_human_approval");
        return { status: "pending_approval", action, permission };
      }

      action = this.approvalStore.get(approvedActionId);
      if (!action) {
        return { status: "denied", reason: "approval_action_not_found", permission };
      }
      if (!sameToolCall(action.toolCall, toolCall)) {
        return { status: "denied", reason: "approved_action_payload_mismatch", permission };
      }
      if (action.status === "rejected") {
        return { status: "denied", reason: "human_rejected", permission };
      }
      if (action.status === "pending") {
        return { status: "pending_approval", action, permission };
      }
    }

    const idempotencyKey = createIdempotencyKey(toolCall, action?.id);
    const cached = this.idempotencyStore.get(idempotencyKey);
    if (cached) {
      return {
        status: "executed",
        result: cached.result,
        idempotencyKey,
        fromCache: true
      };
    }

    const registered = this.registry.get(toolCall.name);
    if (!registered) {
      await this.audit(toolCall, "failed", "unknown_tool");
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }

    try {
      const result = await registered.handler(toolCall.arguments);
      this.idempotencyStore.save(idempotencyKey, result);
      if (action?.status === "approved") {
        this.approvalStore.markExecuted(action.id);
      }
      await this.audit(
        toolCall,
        "executed",
        "tool_executed",
        authorizationDecision?.policy
      );
      return { status: "executed", result, idempotencyKey, fromCache: false };
    } catch (error) {
      await this.audit(
        toolCall,
        "failed",
        error instanceof Error ? error.message : String(error),
        authorizationDecision?.policy
      );
      throw error;
    }
  }

  private checkAuthorization(toolCall: AgentToolCall) {
    const context = this.options.authorization;
    if (!context) return undefined;
    const action = (context.actionResolver ?? defaultActionResolver)(toolCall);
    const resource = (context.resourceResolver ?? defaultResourceResolver)(toolCall);
    return authorize({
      actor: context.actor,
      agentId: context.agentId,
      action,
      resource
    });
  }

  private async audit(
    toolCall: AgentToolCall,
    outcome: "allowed" | "denied" | "executed" | "failed",
    reason: string,
    policy?: string
  ): Promise<void> {
    const auth = this.options.authorization;
    const resource = auth
      ? (auth.resourceResolver ?? defaultResourceResolver)(toolCall)
      : defaultResourceResolver(toolCall);
    const action = auth
      ? (auth.actionResolver ?? defaultActionResolver)(toolCall)
      : defaultActionResolver(toolCall);

    await this.auditSink.write(
      createAuditEvent({
        actorId: auth?.actor.id ?? "system",
        agentId: auth?.agentId ?? "agent",
        action,
        resourceId: resource.id,
        resourceType: resource.type,
        outcome,
        reason,
        policy,
        traceId: this.options.traceId
      })
    );
  }
}
