import type { ToolDefinition } from "../llm/types.js";

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<unknown>;

export type RegisteredTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};
