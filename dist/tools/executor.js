export async function executeTool(registry, toolCall) {
    const registered = registry.get(toolCall.name);
    if (!registered) {
        throw new Error(`Unknown tool: ${toolCall.name}`);
    }
    return registered.handler(toolCall.arguments);
}
