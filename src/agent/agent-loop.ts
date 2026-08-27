import { callLLM } from "../llm/client.js";
import { extractText, extractToolCalls } from "../llm/response-parser.js";
import type { AgentMessage, LLMProvider } from "../llm/types.js";
import { executeTool } from "../tools/executor.js";
import { ToolRegistry } from "../tools/registry.js";

export type AgentLoopResult = {
  text: string;
  messages: AgentMessage[];
  steps: number;
};

export async function runAgentLoop(
  provider: LLMProvider,
  registry: ToolRegistry,
  userMessage: string,
  maxSteps = 6
): Promise<AgentLoopResult> {
  const messages: AgentMessage[] = [{ role: "user", content: userMessage }];

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
