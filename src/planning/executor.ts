import type { PlannerAction } from "./types.js";
import { assertActionAllowed } from "./policy.js";

export async function executeAction(action: PlannerAction): Promise<unknown> {
  assertActionAllowed(action);

  switch (action.type) {
    case "search_customer":
      return {
        id: "C001",
        name: action.input.name,
        intent: "high",
        product: "PLC"
      };

    case "search_chat_history":
      return {
        customerId: action.input.customerId,
        concern: "周末班 上课时间"
      };

    case "search_knowledge":
      return {
        query: action.input.query,
        content: "PLC 课程支持周末班，周六、周日均有课程安排。"
      };

    case "finish":
      return action.input.answer;
  }
}
