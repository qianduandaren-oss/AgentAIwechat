import { createId } from "../shared/utils.js";
import { ToolRegistry } from "./registry.js";

const customers = [
  {
    id: "customer_001",
    name: "张三",
    phone: "13800000001",
    intent: "high",
    notes: "想了解 PLC 课程，但担心就业。"
  },
  {
    id: "customer_002",
    name: "李四",
    phone: "13800000002",
    intent: "low",
    notes: "暂时不需要课程。"
  }
];

const reminderByKey = new Map<string, Record<string, unknown>>();

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(
    {
      name: "search_customer",
      description: "Search a CRM customer by name",
      inputSchema: {
        type: "object",
        properties: { keyword: { type: "string" } },
        required: ["keyword"]
      }
    },
    async args => {
      const keyword = String(args.keyword ?? "");
      return customers.find(c => c.name.includes(keyword)) ?? null;
    }
  );

  registry.register(
    {
      name: "create_reminder",
      description: "Create a customer follow-up reminder",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" },
          topic: { type: "string" },
          time: { type: "string" },
          idempotencyKey: { type: "string" }
        },
        required: ["customerId", "topic", "time", "idempotencyKey"]
      }
    },
    async args => {
      const key = String(args.idempotencyKey ?? "");
      const existing = reminderByKey.get(key);
      if (existing) return existing;

      const reminder = {
        id: createId("reminder"),
        customerId: String(args.customerId),
        topic: String(args.topic),
        time: String(args.time),
        idempotencyKey: key
      };
      reminderByKey.set(key, reminder);
      return reminder;
    }
  );

  registry.register(
    {
      name: "send_course_info",
      description: "Send course information to a customer",
      inputSchema: {
        type: "object",
        properties: { customerId: { type: "string" } },
        required: ["customerId"]
      }
    },
    async args => ({ ok: true, customerId: String(args.customerId) })
  );

  return registry;
}
