export function selectRelevantMemory(query, memories) {
    if (/联系|时间|方便|之前/.test(query)) {
        return memories.filter(m => ["contactTime", "name"].includes(m.key));
    }
    if (/就业|工作|顾虑|担心/.test(query)) {
        return memories.filter(m => m.key === "mainConcern");
    }
    return [];
}
