import type {
  AgentToolCall,
  MockRawLLMResponse,
  MockRawBlock
} from "./types.js";

function isRawResponse(value: unknown): value is MockRawLLMResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { output?: unknown };
  return Array.isArray(candidate.output);
}

/** Day 2 缺失的核心函数：解析一个或多个 Tool Call。 */
export function extractToolCalls(response: unknown): AgentToolCall[] {
  if (!isRawResponse(response)) return [];

  return response.output
    .filter((block): block is Extract<MockRawBlock, { type: "tool_call" }> =>
      block.type === "tool_call"
    )
    .map(block => ({
      id: block.id,
      name: block.name,
      arguments: block.arguments
    }));
}

export function extractText(response: unknown): string {
  if (!isRawResponse(response)) return "";
  return response.output
    .filter((block): block is Extract<MockRawBlock, { type: "text" }> =>
      block.type === "text"
    )
    .map(block => block.text)
    .join("\n");
}

export function extractStructured<T>(response: unknown): T {
  if (!isRawResponse(response) || response.structured === undefined) {
    throw new Error("LLM response does not contain structured output");
  }
  return response.structured as T;
}
