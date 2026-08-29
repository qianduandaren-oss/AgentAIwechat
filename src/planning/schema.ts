import type { JsonSchema } from "../llm/types.js";

export const PLANNER_ACTION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "search_customer",
        "search_chat_history",
        "search_knowledge",
        "finish"
      ]
    },
    input: {
      type: "object",
      description: "Action-specific input. It is validated again by the program before execution."
    }
  },
  required: ["type", "input"]
};

export const PLANNER_ACTION_SPACE = [
  "search_customer",
  "search_chat_history",
  "search_knowledge",
  "finish"
] as const;
