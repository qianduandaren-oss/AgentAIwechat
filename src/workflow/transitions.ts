import type { WorkflowState, WorkflowStep } from "./types.js";

export function getNextStep(state: WorkflowState): WorkflowStep {
  switch (state.currentStep) {
    case "LOAD_CUSTOMER":
      return "CHECK_INTENT";
    case "CHECK_INTENT":
      return state.customer?.intent === "high" ? "CHECK_FOLLOWUP" : "DONE";
    case "CHECK_FOLLOWUP":
      return state.followupExists ? "DONE" : "CREATE_FOLLOWUP";
    case "CREATE_FOLLOWUP":
      return "WRITE_LOG";
    case "WRITE_LOG":
      return "SEND_NOTIFICATION";
    case "SEND_NOTIFICATION":
      return "DONE";
    default:
      return state.currentStep;
  }
}
