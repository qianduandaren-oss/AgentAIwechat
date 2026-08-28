import type { PlannerAction } from "./types.js";

export function createActionKey(action: PlannerAction): string {
  if (action.type === "finish") {
    return "finish";
  }

  return JSON.stringify({
    type: action.type,
    input: action.input
  });
}
