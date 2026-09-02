import { callLLM } from "../llm/client.js";
import { extractText, extractToolCalls } from "../llm/response-parser.js";
import type { AgentMessage, LLMProvider } from "../llm/types.js";
import { executeTool } from "../tools/executor.js";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentTrajectory, TrajectoryEvent } from "../evaluation/trajectory-types.js";

export type AgentLoopResult = {
  text: string;
  messages: AgentMessage[];
  steps: number;
  trajectory: AgentTrajectory;
};

export async function runAgentLoop(
  provider: LLMProvider,
  registry: ToolRegistry,
  userMessage: string,
  maxSteps = 6
): Promise<AgentLoopResult> {
  const messages: AgentMessage[] = [{ role: "user", content: userMessage }];
  const events: TrajectoryEvent[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    events.push({ step, type: "llm_turn" });

    const raw = await callLLM(provider, {
      task: "agent_turn",
      messages,
      tools: registry.listDefinitions()
    });

    const calls = extractToolCalls(raw);
    if (calls.length === 0) {
      const text = extractText(raw);
      events.push({ step, type: "final_answer", content: text });
      return {
        text,
        messages,
        steps: step,
        trajectory: { goal: userMessage, events, totalSteps: step }
      };
    }

    for (const call of calls) {
      events.push({
        step,
        type: "tool_call",
        name: call.name,
        toolCallId: call.id
      });

      const result = await executeTool(registry, call);

      events.push({
        step,
        type: "tool_result",
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify(result)
      });

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
