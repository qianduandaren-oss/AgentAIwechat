import { MockLLMProvider } from "../llm/providers/mock-provider.js";
import { routingEvalCases } from "../evaluation/routing-cases.js";
import { runRoutingEvaluation } from "../evaluation/routing-evaluator.js";

const provider = new MockLLMProvider();
const summary = await runRoutingEvaluation(provider, routingEvalCases);

console.log("\n=== Routing Evaluation ===");
for (const result of summary.results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.caseId} | expected=${result.expectedAgentId} | actual=${result.actualAgentId}`
  );
}

console.log("\n=== Summary ===");
console.log(`total: ${summary.total}`);
console.log(`passed: ${summary.passed}`);
console.log(`failed: ${summary.failed}`);
console.log(`accuracy: ${(summary.accuracy * 100).toFixed(2)}%`);
