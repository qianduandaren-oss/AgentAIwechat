import type { AgentDescriptor } from "./types.js";

const agents: AgentDescriptor[] = [
  {
    id: "coordinator",
    role: "coordinator",
    description: "负责理解总目标、委派子任务并整合结果",
    allowedTools: []
  },
  {
    id: "customer-analysis",
    role: "customer_analysis",
    description: "负责分析客户资料、沟通记录和核心异议",
    allowedTools: [
      "search_customer",
      "search_chat_history",
      "search_knowledge"
    ]
  },
  {
    id: "copywriting",
    role: "copywriting",
    description: "负责根据明确的客户上下文和写作目标生成跟进文案草稿",
    allowedTools: []
  }
];

export function getAgentDescriptor(
  agentId: string
): AgentDescriptor | undefined {
  return agents.find(agent => agent.id === agentId);
}

export function listAgentDescriptors(): AgentDescriptor[] {
  return [...agents];
}
