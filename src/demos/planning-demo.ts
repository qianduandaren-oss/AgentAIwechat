import type { Planner } from "../planning/planner.js";
import { runPlanner } from "../planning/run-planner.js";
import type {
  PlannerAction,
  PlannerState
} from "../planning/types.js";

class DuplicateActionPlanner implements Planner {
  async planNext(state: PlannerState): Promise<PlannerAction> {
    if (state.reflectionNotes.length > 0) {
      return {
        type: "finish",
        input: {
          answer: "重复查询已被 Reflection 拦截，Planner 已安全停止。"
        }
      };
    }

    return {
      type: "search_knowledge",
      input: {
        query: "PLC 周末班"
      }
    };
  }
}

async function main(): Promise<void> {
  console.log("=== Normal planner loop ===");
  await runPlanner(
    "分析张三为什么没有报名，并给出下一步跟进建议"
  );

  console.log("\n=== Duplicate action guard ===");
  let calls = 0;

  await runPlanner("验证重复 Action 防护", {
    planner: new DuplicateActionPlanner(),
    execute: async action => {
      calls++;

      return {
        query: action.type === "search_knowledge"
          ? action.input.query
          : "",
        content: "PLC 课程支持周末班。"
      };
    }
  });

  console.log("Tool executions:", calls);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
