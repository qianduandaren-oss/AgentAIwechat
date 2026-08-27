export class McpToolExecutor {
    clients;
    catalog;
    constructor(clients, catalog) {
        this.clients = clients;
        this.catalog = catalog;
    }
    async execute(toolCall) {
        const tool = this.catalog.find(item => item.name === toolCall.name);
        if (!tool)
            throw new Error(`Unknown MCP tool: ${toolCall.name}`);
        const result = await this.clients[tool.server].callTool(toolCall.name, toolCall.arguments);
        return result.structuredContent ?? result.content.map(item => item.text).join("\n");
    }
    async call(name, args) {
        return this.execute({ id: `direct_${name}`, name, arguments: args });
    }
}
