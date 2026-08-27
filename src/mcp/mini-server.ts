import type { McpToolDefinition, McpToolHandler, McpToolResult } from "./types.js";

/**
 * 教学版 in-process MCP Server。
 * 保留 MCP 最关键的 listTools/callTool 心智模型，保证压缩包无需外部依赖即可运行。
 * official-mcp-example/ 目录另附当前官方 SDK 版 stdio 示例。
 */
export class MiniMcpServer {
  private readonly tools = new Map<string, { definition: McpToolDefinition; handler: McpToolHandler }>();

  constructor(public readonly name: string) {}

  registerTool(definition: McpToolDefinition, handler: McpToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return [...this.tools.values()].map(item => item.definition);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`MCP tool not found: ${name}`);
    return tool.handler(args);
  }
}
