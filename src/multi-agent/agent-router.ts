import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
import type { LLMProvider } from "../llm/types.js";
import {
  listRoutableAgents,
  validateAgentSelection,
  type AgentSelection
} from "./agent-selection.js";

export async function selectAgent(
  provider: LLMProvider,
  goal: string
): Promise<AgentSelection> {
  const candidates = listRoutableAgents().map(agent => ({
    id: agent.id,
    role: agent.role,
    description: agent.description
  }));

  const response = await callLLM(provider, {
    task: "agent_routing",
    messages: [
      {
        role: "system",
        content:
          "你是 Coordinator 的 Agent Router。只能从候选 Agent 中选择一个最适合完成当前目标的 Agent，并返回结构化结果。"
      },
      {
        role: "user",
        content: `Goal:\n${goal}\n\nCandidate Agents:\n${JSON.stringify(candidates, null, 2)}`
      }
    ],
    context: {
      goal,
      candidateAgents: candidates
    }
  });

  const candidate = extractStructured<unknown>(response);
  return validateAgentSelection(candidate);
}
