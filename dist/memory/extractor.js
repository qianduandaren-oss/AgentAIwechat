import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
export async function extractMemoryCandidates(provider, message) {
    const raw = await callLLM(provider, {
        task: "memory_extract",
        messages: [{ role: "user", content: message }]
    });
    return extractStructured(raw);
}
