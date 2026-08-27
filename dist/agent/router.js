import { selectToolDomains } from "../mcp/tool-router.js";
export function routeRequest(message) {
    const toolDomains = selectToolDomains(message);
    const workflow = /查.*客户|张三|李四/.test(message) && /提醒|跟进/.test(message)
        ? "sales_followup"
        : undefined;
    return {
        useMemory: /之前|联系|方便|担心|就业/.test(message),
        useRAG: /退费|退款|退钱|钱还能退|课程规定|就业服务/.test(message),
        toolDomains,
        workflow
    };
}
