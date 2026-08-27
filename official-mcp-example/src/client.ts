import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({
  name: "crm-learning-client",
  version: "1.0.0"
});

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/crm-server.ts"],
  cwd: "."
});

await client.connect(transport);

const { tools } = await client.listTools();
console.log("Available tools:", tools.map(tool => tool.name));

const result = await client.callTool({
  name: "search_customer",
  arguments: {
    keyword: "张三"
  }
});

console.log("Tool result:", result);

await client.close();
