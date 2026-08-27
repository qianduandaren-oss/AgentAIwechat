import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
function assertLeadResult(value) {
    if (!["high", "medium", "low"].includes(value.intent)) {
        throw new Error("Invalid lead intent");
    }
    if (value.confidence < 0 || value.confidence > 1) {
        throw new Error("Invalid confidence");
    }
    return value;
}
export async function analyzeLead(provider, message) {
    const raw = await callLLM(provider, {
        task: "lead_analysis",
        messages: [{ role: "user", content: message }]
    });
    return assertLeadResult(extractStructured(raw));
}
