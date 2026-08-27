import { analyzeLead } from "../day1/lead-analyzer.js";
import { MockLLMProvider } from "../llm/providers/mock-provider.js";
import { runAgentLoop } from "../agent/agent-loop.js";
import { createDefaultToolRegistry } from "../tools/implementations.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import { shouldSaveMemory } from "../memory/policy.js";
import { MemoryStore } from "../memory/store.js";
import { selectRelevantMemory } from "../memory/selector.js";
import { knowledgeDocuments } from "../rag/documents.js";
import { chunkDocuments } from "../rag/chunk.js";
import { buildIndex, retrieve } from "../rag/retriever.js";
import { buildRagContext } from "../rag/context.js";
import { createCrmMcpServer } from "../mcp/servers/crm-server.js";
import { createCalendarMcpServer } from "../mcp/servers/calendar-server.js";
import { MiniMcpClient } from "../mcp/mini-client.js";
import { buildToolCatalog } from "../mcp/catalog.js";
import { selectCandidateTools } from "../mcp/tool-router.js";
import { McpToolExecutor } from "../mcp/executor.js";
import { ProductionAgent } from "../app/production-agent.js";
import { requestHumanApproval, reviewApproval, assertApproved } from "../workflow/approval.js";
function title(text) {
    console.log(`\n========== ${text} ==========`);
}
export async function runFullDemo() {
    const llm = new MockLLMProvider();
    title("Day 1 - Structured Output");
    console.log(await analyzeLead(llm, "我想了解一下 PLC 课程和报名价格"));
    title("Day 2 - Tool Calling + Agent Loop");
    const localRegistry = createDefaultToolRegistry();
    const loop = await runAgentLoop(llm, localRegistry, "查一下张三，如果他是高意向客户，明天下午3点提醒我跟进");
    console.log({ final: loop.text, steps: loop.steps });
    title("Day 3 - Memory");
    const memoryStore = new MemoryStore();
    const memoryInput = "我叫王明，以后尽量下午联系我，我比较担心就业问题";
    const candidates = await extractMemoryCandidates(llm, memoryInput);
    for (const candidate of candidates) {
        if (shouldSaveMemory(candidate))
            memoryStore.save("user_001", candidate);
    }
    console.log(selectRelevantMemory("我之前说什么时候联系方便？", memoryStore.list("user_001")));
    title("Day 4 - Mini RAG");
    const chunks = chunkDocuments(knowledgeDocuments);
    const ragIndex = await buildIndex(chunks);
    const results = await retrieve("报名以后不想学了，钱还能退吗？", ragIndex);
    console.log(results.map(item => ({ title: item.title, score: Number(item.score.toFixed(3)), year: item.year })));
    console.log(buildRagContext(results));
    title("Day 5 - MCP: discovery + call + routing");
    const crmClient = new MiniMcpClient("crm", createCrmMcpServer());
    const calendarClient = new MiniMcpClient("calendar", createCalendarMcpServer());
    await crmClient.connect();
    await calendarClient.connect();
    const clients = { crm: crmClient, calendar: calendarClient };
    const catalog = await buildToolCatalog(clients);
    console.log("All tools:", catalog.map(tool => `${tool.server}:${tool.name}`));
    console.log("Candidate tools:", selectCandidateTools("查一下张三，明天下午提醒我跟进", catalog).map(tool => `${tool.server}:${tool.name}`));
    console.log("Direct MCP call:", await crmClient.callTool("search_customer", { keyword: "张三" }));
    title("Day 6 - Workflow + Retry + Idempotency");
    const mcp = new McpToolExecutor(clients, catalog);
    const productionAgent = new ProductionAgent(llm, memoryStore, ragIndex, mcp);
    console.log(await productionAgent.handle("user_001", "查一下张三，如果他是高意向客户，明天下午3点提醒我跟进"));
    const first = await mcp.call("create_reminder", {
        customerId: "customer_001",
        topic: "幂等演示",
        time: "tomorrow 15:00",
        idempotencyKey: "demo:same-key"
    });
    const second = await mcp.call("create_reminder", {
        customerId: "customer_001",
        topic: "幂等演示",
        time: "tomorrow 15:00",
        idempotencyKey: "demo:same-key"
    });
    console.log("Idempotency same id:", first.id === second.id);
    title("Day 6 - Human-in-the-loop guard");
    let approvalState = {
        requestId: "approval_demo",
        userId: "user_001",
        customerKeyword: "张三",
        currentStep: "DONE",
        steps: {},
        history: []
    };
    approvalState = requestHumanApproval(approvalState);
    try {
        assertApproved(approvalState);
    }
    catch (error) {
        console.log("Blocked before approval:", error instanceof Error ? error.message : String(error));
    }
    approvalState = reviewApproval(approvalState, true, "reviewer_001", "风险检查通过");
    assertApproved(approvalState);
    console.log("Approved: high-risk action can continue.");
    title("Integrated Agent - Memory + RAG");
    console.log(await productionAgent.handle("user_001", "我之前说什么时候联系方便？"));
    console.log(await productionAgent.handle("user_001", "PLC课程退费规则是什么？"));
    await crmClient.close();
    await calendarClient.close();
}
