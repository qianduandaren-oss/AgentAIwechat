export function requestHumanApproval(state) {
    return {
        ...state,
        currentStep: "WAITING_APPROVAL",
        approval: { status: "pending" }
    };
}
export function reviewApproval(state, approved, reviewerId, comment) {
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
export function assertApproved(state) {
    if (state.approval?.status !== "approved") {
        throw new Error("High-risk action is blocked until human approval");
    }
}
