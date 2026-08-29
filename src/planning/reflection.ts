import { createActionKey } from "./action-key.js";
import type { PlannerAction, PlannerState } from "./types.js";

export interface ReflectionResult {
  allowed: boolean;
  reason?: string;
  severity?: "info" | "warning" | "critical";
}

export interface ObservationReflection {
  useful: boolean;
  note?: string;
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

export function reflectObservation(result: unknown): ObservationReflection {
  if (result === null || result === undefined) {
    return {
      useful: false,
      note: "Observation is empty; re-plan instead of assuming the tool succeeded."
    };
  }

  if (typeof result === "string" && !result.trim()) {
    return {
      useful: false,
      note: "Observation is an empty string; choose another action or finish with explicit uncertainty."
    };
  }

  if (
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.keys(result as Record<string, unknown>).length === 0
  ) {
    return {
      useful: false,
      note: "Observation is an empty object; the next plan must account for missing evidence."
    };
  }

  return { useful: true };
}
