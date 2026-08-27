import type { WorkflowState } from "./types.js";

export function requestHumanApproval(state: WorkflowState): WorkflowState {
  return {
    ...state,
    currentStep: "WAITING_APPROVAL",
    approval: { status: "pending" }
  };
}

export function reviewApproval(
  state: WorkflowState,
  approved: boolean,
  reviewerId: string,
  comment?: string
): WorkflowState {
  if (state.currentStep !== "WAITING_APPROVAL") {
    throw new Error("Workflow is not waiting for approval");
  }
  return {
    ...state,
    approval: {
      status: approved ? "approved" : "rejected",
      reviewerId,
      reviewedAt: new Date().toISOString(),
      comment
    }
  };
}

export function assertApproved(state: WorkflowState): void {
  if (state.approval?.status !== "approved") {
    throw new Error("High-risk action is blocked until human approval");
  }
}
