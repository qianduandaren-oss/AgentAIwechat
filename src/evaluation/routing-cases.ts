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
  }
];
