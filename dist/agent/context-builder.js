import { selectRelevantMemory } from "../memory/selector.js";
import { retrieve } from "../rag/retriever.js";
import { routeRequest } from "./router.js";
export async function buildContext(userId, message, memoryStore, ragIndex) {
    const route = routeRequest(message);
    const memory = route.useMemory
        ? selectRelevantMemory(message, memoryStore.list(userId))
        : [];
    const knowledge = route.useRAG
        ? await retrieve(message, ragIndex)
        : [];
    return { route, memory, knowledge };
}
