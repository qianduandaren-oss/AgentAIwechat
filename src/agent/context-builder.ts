import { selectRelevantMemory } from "../memory/selector.js";
import { MemoryStore } from "../memory/store.js";
import { retrieve, type IndexedChunk } from "../rag/retriever.js";
import { routeRequest } from "./router.js";

export async function buildContext(
  userId: string,
  message: string,
  memoryStore: MemoryStore,
  ragIndex: IndexedChunk[]
): Promise<{
  route: ReturnType<typeof routeRequest>;
  memory: ReturnType<typeof selectRelevantMemory>;
  knowledge: Awaited<ReturnType<typeof retrieve>>;
}> {
  const route = routeRequest(message);
  const memory = route.useMemory
    ? selectRelevantMemory(message, memoryStore.list(userId))
    : [];
  const knowledge = route.useRAG
    ? await retrieve(message, ragIndex)
    : [];

  return { route, memory, knowledge };
}
