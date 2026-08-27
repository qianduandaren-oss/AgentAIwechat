import type { McpToolDefinition } from "./types.js";
import { MiniMcpClient } from "./mini-client.js";

export type ToolDomain = "crm" | "calendar";

export type CatalogTool = McpToolDefinition & {
  server: ToolDomain;
};

export type ClientMap = Record<ToolDomain, MiniMcpClient>;

export async function buildToolCatalog(clients: ClientMap): Promise<CatalogTool[]> {
  const output: CatalogTool[] = [];
  for (const [server, client] of Object.entries(clients) as Array<[ToolDomain, MiniMcpClient]>) {
    const tools = await client.listTools();
    output.push(...tools.map(tool => ({ ...tool, server })));
  }
  return output;
}
