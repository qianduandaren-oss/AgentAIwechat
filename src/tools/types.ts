import type { ToolDefinition } from "../llm/types.js";

export type ToolExecutionContext = {
  signal?: AbortSignal;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => Promise<unknown>;

export type RegisteredTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};
