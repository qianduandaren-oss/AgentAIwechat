function isRawResponse(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return Array.isArray(candidate.output);
}
/** Day 2 缺失的核心函数：解析一个或多个 Tool Call。 */
export function extractToolCalls(response) {
    if (!isRawResponse(response))
        return [];
    return response.output
        .filter((block) => block.type === "tool_call")
        .map(block => ({
        id: block.id,
        name: block.name,
        arguments: block.arguments
    }));
}
export function extractText(response) {
    if (!isRawResponse(response))
        return "";
    return response.output
        .filter((block) => block.type === "text")
        .map(block => block.text)
        .join("\n");
}
export function extractStructured(response) {
    if (!isRawResponse(response) || response.structured === undefined) {
        throw new Error("LLM response does not contain structured output");
    }
    return response.structured;
}
