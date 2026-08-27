import { callLLM } from "../llm/client.js";
import { extractMemoryCandidates } from "../memory/extractor.js";
import { shouldSaveMemory } from "../memory/policy.js";
import { extractText } from "../llm/response-parser.js";
import { buildContext } from "../agent/context-builder.js";
import { createId } from "../shared/utils.js";
import { createWorkflowNodes } from "../workflow/nodes.js";
import { MemoryWorkflowStateStore } from "../workflow/persistence.js";
import { runWorkflow } from "../workflow/runner.js";
export class ProductionAgent {
    provider;
    memoryStore;
    ragIndex;
    mcp;
    workflowStore = new MemoryWorkflowStateStore();
    constructor(provider, memoryStore, ragIndex, mcp) {
        this.provider = provider;
        this.memoryStore = memoryStore;
        this.ragIndex = ragIndex;
        this.mcp = mcp;
    }
    async handle(userId, message) {
        const candidates = await extractMemoryCandidates(this.provider, message);
        for (const candidate of candidates) {
            if (shouldSaveMemory(candidate))
                this.memoryStore.save(userId, candidate);
        }
        const context = await buildContext(userId, message, this.memoryStore, this.ragIndex);
        if (context.route.workflow === "sales_followup") {
            const state = {
                requestId: createId("workflow"),
                userId,
                customerKeyword: message.includes("李四") ? "李四" : "张三",
                currentStep: "LOAD_CUSTOMER",
                steps: {},
                history: []
            };
            const nodes = createWorkflowNodes(this.provider, this.mcp);
            const result = await runWorkflow(state, nodes, this.workflowStore);
            return `Workflow=${result.currentStep}; path=${result.history.join(" -> ")}; followupId=${result.followupId ?? "none"}`;
        }
        const raw = await callLLM(this.provider, {
            task: "answer_with_context",
            messages: [{ role: "user", content: message }],
            context: {
                memory: context.memory,
                knowledge: context.knowledge
            }
        });
        return extractText(raw);
    }
}
