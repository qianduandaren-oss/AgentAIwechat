import type { JsonSchema } from "../llm/types.js";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
};

export type McpToolHandler = (
  args: Record<string, unknown>
) => Promise<McpToolResult>;
