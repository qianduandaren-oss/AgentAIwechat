import { buildSafeToolResult, type CustomerToolResult } from "../security/safe-tool-result.js";

const rawCustomer: CustomerToolResult = {
  id: "customer_001",
  name: "示例客户",
  phone: "13812345678",
  intentCourse: "PLC 周末班",
  recentSummary: "最近两次都在询问周末上课时间和就业方向。",
  ownerId: "sales_bj_01"
};

const safe = buildSafeToolResult(rawCustomer, {
  includeName: true,
  includeMaskedPhone: true
});

console.log("=== Safe LLM Context ===");
console.log(JSON.stringify(safe.llmContext, null, 2));
console.log("\n=== Sanitized Log Payload ===");
console.log(JSON.stringify(safe.logPayload, null, 2));
console.log("\nphone sent masked:", safe.llmContext.phone === "138****5678");
