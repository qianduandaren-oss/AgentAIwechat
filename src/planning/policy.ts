import type { PlanningAction, PlanningActionType, PlanningDecision } from "./types.js";

const ALLOWED_ACTIONS = new Set<PlanningActionType>([
  "search_customer",
  "search_chat_history",
  "search_order",
  "search_knowledge",
  "create_followup_plan",
  "finish"
]);

export const PLANNER_SIDE_EFFECT_BOUNDARY = [
  "create_reminder",
  "send_message",
  "update_customer",
  "delete_customer",
  "charge_payment",
  "refund_order"
] as const;

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`Planning action field \"${field}\" cannot be empty.`);
  }
}

export function assertActionAllowed(action: PlanningAction): void {
  if (!ALLOWED_ACTIONS.has(action.type)) {
    throw new Error(`Planning action \"${action.type}\" is not allowed.`);
  }

  switch (action.type) {
    case "search_customer":
      assertNonEmpty(action.customerName, "customerName");
      return;
    case "search_chat_history":
    case "search_order":
    case "create_followup_plan":
      assertNonEmpty(action.customerId, "customerId");
      return;
    case "search_knowledge":
      assertNonEmpty(action.query, "query");
      return;
    case "finish":
      assertNonEmpty(action.answer, "answer");
      return;
  }
}

export function assertDecisionAllowed(decision: PlanningDecision): void {
  if (!decision.reason.trim()) {
    throw new Error("Planner decision must include a reason.");
  }

  assertActionAllowed(decision.action);
}

export function shouldExecuteTool(action: PlanningAction): boolean {
  return action.type !== "finish";
}
