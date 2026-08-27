import type { AgentToolCall } from "../llm/types.js";
import type { CatalogTool, ClientMap } from "./catalog.js";

export class McpToolExecutor {
  constructor(
    private readonly clients: ClientMap,
    private readonly catalog: CatalogTool[]
  ) {}

  async execute(toolCall: AgentToolCall): Promise<unknown> {
    const tool = this.catalog.find(item => item.name === toolCall.name);
    if (!tool) throw new Error(`Unknown MCP tool: ${toolCall.name}`);

    const result = await this.clients[tool.server].callTool(
      toolCall.name,
      toolCall.arguments
    );

    return result.structuredContent ?? result.content.map(item => item.text).join("\n");
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.execute({ id: `direct_${name}`, name, arguments: args });
  }
}
