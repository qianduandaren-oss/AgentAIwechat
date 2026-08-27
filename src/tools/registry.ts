import type { RegisteredTool, ToolHandler } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(item => item.definition);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }
}
