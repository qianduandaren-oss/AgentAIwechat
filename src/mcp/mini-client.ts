import { MiniMcpServer } from "./mini-server.js";
import type { McpToolDefinition, McpToolResult } from "./types.js";

export class MiniMcpClient {
  private connected = false;

  constructor(
    public readonly serverName: string,
    private readonly server: MiniMcpServer
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    this.assertConnected();
    return this.server.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    this.assertConnected();
    return this.server.callTool(name, args);
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error(`MCP client ${this.serverName} is not connected`);
  }
}
