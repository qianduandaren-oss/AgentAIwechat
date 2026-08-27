import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
import { TransientWorkflowError } from "./errors.js";
export function createWorkflowNodes(provider, mcp) {
    let writeLogTransientFailures = 0;
    return {
        LOAD_CUSTOMER: async (state) => {
            const customer = await mcp.call("search_customer", {
                keyword: state.customerKeyword
            });
            if (!customer || typeof customer !== "object") {
                throw new Error("Customer not found");
            }
            return { ...state, customer: customer };
        },
        CHECK_INTENT: async (state) => {
            if (!state.customer)
                throw new Error("Customer missing");
            const raw = await callLLM(provider, {
                task: "intent_classification",
                messages: [{ role: "user", content: state.customer.notes }],
                context: { conversation: state.customer.notes }
            });
            const result = extractStructured(raw);
            return {
                ...state,
                customer: { ...state.customer, intent: result.intent }
            };
        },
        CHECK_FOLLOWUP: async (state) => {
            if (!state.customer)
                throw new Error("Customer missing");
            const result = (await mcp.call("check_followup", {
                customerId: state.customer.id
            }));
            return { ...state, followupExists: result.exists };
        },
        CREATE_FOLLOWUP: async (state) => {
            if (!state.customer)
                throw new Error("Customer missing");
            const result = (await mcp.call("create_reminder", {
                customerId: state.customer.id,
                topic: `跟进${state.customer.name}`,
                time: "tomorrow 15:00",
                idempotencyKey: `${state.requestId}:CREATE_FOLLOWUP`
            }));
            return { ...state, followupId: result.id };
        },
        WRITE_LOG: async (state) => {
            if (!state.customer)
                throw new Error("Customer missing");
            if (writeLogTransientFailures < 1) {
                writeLogTransientFailures++;
                throw new TransientWorkflowError("Simulated CRM timeout");
            }
            await mcp.call("write_crm_log", {
                customerId: state.customer.id,
                message: `Created followup ${state.followupId}`,
                idempotencyKey: `${state.requestId}:WRITE_LOG`
            });
            return state;
        },
        SEND_NOTIFICATION: async (state) => {
            // 教学版不真正发送消息，避免产生外部副作用。
            return state;
        }
    };
}
