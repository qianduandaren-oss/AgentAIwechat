import type { AgentToolCall } from "../llm/types.js";
import { ToolRegistry } from "./registry.js";

export async function executeTool(
  registry: ToolRegistry,
  toolCall: AgentToolCall
): Promise<unknown> {
  const registered = registry.get(toolCall.name);
  if (!registered) {
    throw new Error(`Unknown tool: ${toolCall.name}`);
  }
  return registered.handler(toolCall.arguments);
}
