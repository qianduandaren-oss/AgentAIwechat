import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
import type { LLMProvider } from "../llm/types.js";
import type { MemoryCandidate } from "./types.js";

export async function extractMemoryCandidates(
  provider: LLMProvider,
  message: string
): Promise<MemoryCandidate[]> {
  const raw = await callLLM(provider, {
    task: "memory_extract",
    messages: [{ role: "user", content: message }]
  });
  return extractStructured<MemoryCandidate[]>(raw);
}
