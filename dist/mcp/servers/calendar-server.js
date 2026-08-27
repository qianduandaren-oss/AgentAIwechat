import { createId } from "../../shared/utils.js";
import { MiniMcpServer } from "../mini-server.js";
const reminderByKey = new Map();
export function createCalendarMcpServer() {
    const server = new MiniMcpServer("calendar");
    server.registerTool({
        name: "check_followup",
        description: "Check whether a follow-up reminder already exists",
        inputSchema: {
            type: "object",
            properties: { customerId: { type: "string" } },
            required: ["customerId"]
        }
    }, async (args) => {
        const customerId = String(args.customerId);
        const reminder = [...reminderByKey.values()].find(r => r.customerId === customerId);
        const result = { exists: Boolean(reminder), reminder: reminder ?? null };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    });
    server.registerTool({
        name: "create_reminder",
        description: "Create an idempotent follow-up reminder",
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
    }, async (args) => {
        const key = String(args.idempotencyKey);
        const existing = reminderByKey.get(key);
        const reminder = existing ??
            {
                id: createId("followup"),
                customerId: String(args.customerId),
                topic: String(args.topic),
                time: String(args.time),
                idempotencyKey: key
            };
        if (!existing)
            reminderByKey.set(key, reminder);
        return {
            content: [{ type: "text", text: JSON.stringify(reminder) }],
            structuredContent: reminder
        };
    });
    return server;
}
