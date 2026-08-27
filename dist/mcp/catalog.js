export async function buildToolCatalog(clients) {
    const output = [];
    for (const [server, client] of Object.entries(clients)) {
        const tools = await client.listTools();
        output.push(...tools.map(tool => ({ ...tool, server })));
    }
    return output;
}
