export class MiniMcpClient {
    serverName;
    server;
    connected = false;
    constructor(serverName, server) {
        this.serverName = serverName;
        this.server = server;
    }
    async connect() {
        this.connected = true;
    }
    async close() {
        this.connected = false;
    }
    async listTools() {
        this.assertConnected();
        return this.server.listTools();
    }
    async callTool(name, args) {
        this.assertConnected();
        return this.server.callTool(name, args);
    }
    assertConnected() {
        if (!this.connected)
            throw new Error(`MCP client ${this.serverName} is not connected`);
    }
}
