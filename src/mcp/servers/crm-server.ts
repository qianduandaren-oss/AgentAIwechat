import { MiniMcpServer } from "../mini-server.js";

const customers = [
  {
    id: "customer_001",
    name: "张三",
    phone: "13800000001",
    notes: "最近工作比较忙，但 PLC 方向还是想了解，主要担心就业。"
  },
  {
    id: "customer_002",
    name: "李四",
    phone: "13800000002",
    notes: "暂时不需要课程，没有继续了解的计划。"
  }
];

const logs: Array<Record<string, unknown>> = [];

export function createCrmMcpServer(): MiniMcpServer {
  const server = new MiniMcpServer("crm");

  server.registerTool(
    {
      name: "search_customer",
      description: "Search CRM customer by name or phone",
      inputSchema: {
        type: "object",
        properties: { keyword: { type: "string" } },
        required: ["keyword"]
      }
    },
    async args => {
      const keyword = String(args.keyword ?? "");
      const customer = customers.find(
        item => item.name.includes(keyword) || item.phone.includes(keyword)
      );
      return {
        content: [{ type: "text", text: JSON.stringify(customer ?? null) }],
        structuredContent: customer ?? null
      };
    }
  );

  server.registerTool(
    {
      name: "write_crm_log",
      description: "Write an operation log to CRM",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" },
          message: { type: "string" },
          idempotencyKey: { type: "string" }
        },
        required: ["customerId", "message", "idempotencyKey"]
      }
    },
    async args => {
      const key = String(args.idempotencyKey);
      const existing = logs.find(log => log.idempotencyKey === key);
      const log = existing ?? { ...args, createdAt: new Date().toISOString() };
      if (!existing) logs.push(log);
      return {
        content: [{ type: "text", text: JSON.stringify(log) }],
        structuredContent: log
      };
    }
  );

  return server;
}
