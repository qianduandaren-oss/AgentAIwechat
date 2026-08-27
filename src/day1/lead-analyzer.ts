import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
import type { LLMProvider } from "../llm/types.js";

export type LeadResult = {
  intent: "high" | "medium" | "low";
  reason: string;
  nextAction: "sales_follow_up" | "later_follow_up" | "ignore";
  confidence: number;
};

function assertLeadResult(value: LeadResult): LeadResult {
  if (!["high", "medium", "low"].includes(value.intent)) {
    throw new Error("Invalid lead intent");
  }
  if (value.confidence < 0 || value.confidence > 1) {
    throw new Error("Invalid confidence");
  }
  return value;
}

export async function analyzeLead(provider: LLMProvider, message: string): Promise<LeadResult> {
  const raw = await callLLM(provider, {
    task: "lead_analysis",
    messages: [{ role: "user", content: message }]
  });

  return assertLeadResult(extractStructured<LeadResult>(raw));
}
