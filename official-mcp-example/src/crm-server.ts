import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const customers = [
  { id: "customer_001", name: "张三", phone: "13800000001", status: "interested" },
  { id: "customer_002", name: "李四", phone: "13800000002", status: "new" }
];

const handle = serveStdio(() => {
  const server = new McpServer({
    name: "crm-server",
    version: "1.0.0"
  });

  server.registerTool(
    "search_customer",
    {
      title: "Search Customer",
      description: "Search a CRM customer by name or phone number",
      inputSchema: z.object({
        keyword: z.string().min(1)
      })
    },
    async ({ keyword }) => {
      const customer = customers.find(
        item => item.name.includes(keyword) || item.phone.includes(keyword)
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(customer ?? null)
          }
        ],
        structuredContent: customer ?? null
      };
    }
  );

  return server;
});

console.error("crm-server listening on stdio");

process.on("SIGINT", () => {
  void handle.close();
});
