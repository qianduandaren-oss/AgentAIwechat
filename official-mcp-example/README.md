# 官方 MCP TypeScript SDK 示例

这个目录与主教学项目分开，是因为官方 MCP SDK 会持续演进，而主项目希望做到下载后无需安装依赖即可运行。

截至 2026-08-27，官方 TypeScript SDK 已拆分为：

```text
@modelcontextprotocol/server
@modelcontextprotocol/client
```

stdio Server 当前推荐使用：

```text
serveStdio(() => buildServer())
```

Client 使用：

```text
Client
StdioClientTransport
client.connect()
client.listTools()
client.callTool()
```

## 运行

```bash
npm install
npm run client
```

Client 会启动 `crm-server.ts` 子进程，再执行 Tool Discovery 和 Tool Call。

注意：stdio 的 stdout 是协议通道，所以 Server 调试日志应使用 `console.error()`，不要使用 `console.log()` 污染协议输出。
