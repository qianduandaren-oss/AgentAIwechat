import type { AgentToolCall } from "../llm/types.js";
import { createId } from "../shared/utils.js";

export type PendingActionStatus = "pending" | "approved" | "rejected" | "executed";

export interface PendingAction {
  id: string;
  toolCall: AgentToolCall;
  status: PendingActionStatus;
  createdAt: number;
  reviewedAt?: number;
  reviewerId?: string;
  reviewComment?: string;
  executedAt?: number;
}

function cloneToolCall(toolCall: AgentToolCall): AgentToolCall {
  return {
    ...toolCall,
    arguments: JSON.parse(JSON.stringify(toolCall.arguments)) as Record<string, unknown>
  };
}

export class ApprovalStore {
  private readonly actions = new Map<string, PendingAction>();

  create(toolCall: AgentToolCall): PendingAction {
    const action: PendingAction = {
      id: createId("action"),
      toolCall: cloneToolCall(toolCall),
      status: "pending",
      createdAt: Date.now()
    };
    this.actions.set(action.id, action);
    return this.get(action.id)!;
  }

  get(id: string): PendingAction | undefined {
    const action = this.actions.get(id);
    return action
      ? { ...action, toolCall: cloneToolCall(action.toolCall) }
      : undefined;
  }

  approve(id: string, reviewerId: string, comment?: string): PendingAction {
    return this.review(id, true, reviewerId, comment);
  }

  reject(id: string, reviewerId: string, comment?: string): PendingAction {
    return this.review(id, false, reviewerId, comment);
  }

  markExecuted(id: string): PendingAction {
    const action = this.actions.get(id);
    if (!action) throw new Error(`Pending action not found: ${id}`);
    if (action.status !== "approved") {
      throw new Error(`Action ${id} must be approved before execution`);
    }
    action.status = "executed";
    action.executedAt = Date.now();
    return this.get(id)!;
  }

  list(): PendingAction[] {
    return [...this.actions.keys()].map(id => this.get(id)!);
  }

  private review(
    id: string,
    approved: boolean,
    reviewerId: string,
    comment?: string
  ): PendingAction {
    const action = this.actions.get(id);
    if (!action) throw new Error(`Pending action not found: ${id}`);
    if (action.status !== "pending") {
      throw new Error(`Action ${id} is already ${action.status}`);
    }
    action.status = approved ? "approved" : "rejected";
    action.reviewerId = reviewerId;
    action.reviewedAt = Date.now();
    action.reviewComment = comment;
    return this.get(id)!;
  }
}
