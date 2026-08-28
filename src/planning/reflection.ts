import { createActionKey } from "./action-key.js";
import type { PlannerAction, PlannerState } from "./types.js";

export interface ReflectionResult {
  allowed: boolean;
  reason?: string;
  severity?: "info" | "warning" | "critical";
}

export function reflectAction(
  state: PlannerState,
  action: PlannerAction
): ReflectionResult {
  if (action.type === "finish") {
    return { allowed: true };
  }

  const actionKey = createActionKey(action);

  if (state.visitedActions.includes(actionKey)) {
    return {
      allowed: false,
      reason: `Duplicate action detected: ${actionKey}`,
      severity: "warning"
    };
  }

  return { allowed: true };
}
