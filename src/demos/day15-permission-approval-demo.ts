import type { AgentToolCall } from "../llm/types.js";
import { SecureToolExecutor } from "../security/secure-tool-executor.js";
import { createDefaultToolRegistry } from "../tools/implementations.js";

const registry = createDefaultToolRegistry();
const executor = new SecureToolExecutor(registry);

const call: AgentToolCall = {
  id: "call_send_001",
  name: "send_course_info",
  arguments: { customerId: "customer_001" }
};

const first = await executor.execute(call);
console.log("first", first);

if (first.status !== "pending_approval") {
  throw new Error("Expected pending approval");
}

executor.approvalStore.approve(first.action.id, "manager_001", "确认发送课程资料");

const second = await executor.execute(call, first.action.id);
console.log("second", second);

const third = await executor.execute(call, first.action.id);
console.log("third", third);

console.log("audit", await executor.auditSink.list());
