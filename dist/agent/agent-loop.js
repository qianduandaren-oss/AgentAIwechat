import { callLLM } from "../llm/client.js";
import { extractText, extractToolCalls } from "../llm/response-parser.js";
import { executeTool } from "../tools/executor.js";
export async function runAgentLoop(provider, registry, userMessage, maxSteps = 6) {
    const messages = [{ role: "user", content: userMessage }];
    for (let step = 1; step <= maxSteps; step++) {
        const raw = await callLLM(provider, {
            task: "agent_turn",
            messages,
            tools: registry.listDefinitions()
        });
        const calls = extractToolCalls(raw);
        if (calls.length === 0) {
            return { text: extractText(raw), messages, steps: step };
        }
        for (const call of calls) {
            const result = await executeTool(registry, call);
            messages.push({
                role: "assistant",
                name: call.name,
                toolCallId: call.id,
                content: JSON.stringify({ toolCall: call })
            });
            messages.push({
                role: "tool",
                name: call.name,
                toolCallId: call.id,
                content: JSON.stringify(result)
            });
        }
    }
    throw new Error(`Agent exceeded maxSteps=${maxSteps}`);
}
