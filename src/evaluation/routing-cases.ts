import type { RoutingEvalCase } from "./types.js";

export const routingEvalCases: RoutingEvalCase[] = [
  {
    id: "routing-analysis-01",
    goal: "分析张三为什么没有报名",
    expectedAgentId: "customer-analysis",
    tags: ["customer", "analysis"]
  },
  {
    id: "routing-analysis-02",
    goal: "判断客户目前最核心的异议是什么",
    expectedAgentId: "customer-analysis",
    tags: ["customer", "analysis"]
  },
  {
    id: "routing-copy-01",
    goal: "根据已知客户情况生成一条跟进文案草稿",
    expectedAgentId: "copywriting",
    tags: ["copywriting"]
  },
  {
    id: "routing-copy-02",
    goal: "把客户分析结论改成一段简短的微信跟进措辞",
    expectedAgentId: "copywriting",
    tags: ["copywriting"]
  },
  {
    id: "routing-regression-copy-01",
    goal: "分析已经有了，帮我想一句自然点的跟进话术",
    expectedAgentId: "copywriting",
    tags: ["copywriting", "regression", "paraphrase"],
    note: "回归样本：表达里出现“分析”，但真正动作是生成跟进话术"
  },
  {
    id: "routing-regression-analysis-01",
    goal: "先别写话术，我只想知道客户一直没转化到底卡在哪",
    expectedAgentId: "customer-analysis",
    tags: ["customer", "analysis", "regression", "negation"],
    note: "回归样本：包含“话术”关键词，但用户明确否定写作任务"
  }
];
