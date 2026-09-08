import { buildSafeToolResult, type CustomerToolResult } from "../security/safe-tool-result.js";
import { buildBoundaryPayloads } from "../security/data-leakage-policy.js";

const rawCustomer: CustomerToolResult = {
  id: "customer_001",
  name: "示例客户",
  phone: "13812345678",
  intentCourse: "PLC 周末班",
  recentSummary: "最近两次都在询问周末上课时间和就业方向。",
  ownerId: "sales_001"
};

const safe = buildSafeToolResult(rawCustomer, { includeName: true });

const outputs = buildBoundaryPayloads({
  llm: safe.llmContext,
  memory: { customerId: rawCustomer.id, intentCourse: rawCustomer.intentCourse },
  trace: { operation: "crm.customer.read", toolResult: rawCustomer },
  audit: { actorId: "sales_001", action: "customer.read", resourceId: rawCustomer.id }
});

console.log(JSON.stringify(outputs, null, 2));
