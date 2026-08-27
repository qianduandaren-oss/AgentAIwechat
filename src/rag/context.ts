import type { RetrievedChunk } from "./retriever.js";

export function buildRagContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "NO_RELEVANT_KNOWLEDGE";
  return chunks
    .map(chunk => `来源：${chunk.title}\n年份：${chunk.year}\n${chunk.content}`)
    .join("\n---\n");
}
