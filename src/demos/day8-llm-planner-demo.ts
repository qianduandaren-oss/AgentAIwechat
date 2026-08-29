import type {
  LLMProvider,
  LLMRequest,
  MockRawLLMResponse
} from "../llm/types.js";
import { MockLLMProvider } from "../llm/providers/mock-provider.js";
import { executeAction } from "../planning/executor.js";
import { LLMPlanner } from "../planning/llm-planner.js";
import { runPlanner } from "../planning/run-planner.js";

class InvalidFirstActionProvider implements LLMProvider {
  plannerCalls = 0;
  private invalidReturned = false;
  private readonly fallback = new MockLLMProvider();

  async generate(request: LLMRequest): Promise<MockRawLLMResponse> {
    if (request.task === "planner_next_action") {
      this.plannerCalls++;
    }

    if (request.task === "planner_next_action" && !this.invalidReturned) {
      this.invalidReturned = true;

      return {
        output: [],
        structured: {
          type: "send_message",
          input: {
            customerId: "C001",
            text: "直接发消息"
          }
        }
      };
    }

    return this.fallback.generate(request);
  }
}

async function main(): Promise<void> {
  console.log("=== Day 8: LLM Planner ===");

  await runPlanner(
    "分析张三为什么没有报名，并给出下一步跟进建议",
    {
      planner: new LLMPlanner(new MockLLMProvider())
    }
  );

  console.log("\n=== Day 8: validation + re-planning ===");

  const invalidProvider = new InvalidFirstActionProvider();
  const executedActions: string[] = [];

  await runPlanner(
    "分析张三为什么没有报名，并给出下一步跟进建议",
    {
      planner: new LLMPlanner(invalidProvider, {
        validationRetries: 2
      }),
      execute: async action => {
        executedActions.push(action.type);
        return executeAction(action);
      }
    }
  );

  console.log("Planner model calls:", invalidProvider.plannerCalls);
  console.log("Executor received:", executedActions.join(" -> "));
  console.log("Invalid send_message reached executor:", executedActions.includes("send_message"));
}

main().catch(error => {
  console.error(error);
});
