import type { PlannerAction, PlannerActionType } from "./types.js";

const ALLOWED_ACTIONS = new Set<PlannerActionType>([
  "search_customer",
  "search_chat_history",
  "search_knowledge",
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
    throw new Error(`Planner action field "${field}" cannot be empty.`);
  }
}

export function assertActionAllowed(action: PlannerAction): void {
  if (!ALLOWED_ACTIONS.has(action.type)) {
    throw new Error(`Planner action "${action.type}" is not allowed.`);
  }

  switch (action.type) {
    case "search_customer":
      assertNonEmpty(action.input.name, "name");
      return;
    case "search_chat_history":
      assertNonEmpty(action.input.customerId, "customerId");
      return;
    case "search_knowledge":
      assertNonEmpty(action.input.query, "query");
      return;
    case "finish":
      assertNonEmpty(action.input.answer, "answer");
      return;
  }
}
