import type { PlannerState } from "./types.js";
import { CustomerPlanner } from "./planner.js";
import { executeAction } from "./executor.js";

export const MAX_PLANNER_STEPS = 6;

export async function runPlanner(goal: string): Promise<string> {
  const planner = new CustomerPlanner();

  const state: PlannerState = {
    goal,
    observations: [],
    step: 0
  };

  while (state.step < MAX_PLANNER_STEPS) {
    state.step++;

    const action = await planner.planNext(state);

    console.log(`\nStep ${state.step}`);
    console.log("Action:", action.type);

    if (action.type === "finish") {
      console.log("Answer:", action.input.answer);
      return action.input.answer;
    }

    const result = await executeAction(action);

    console.log("Observation:", result);

    state.observations.push({
      action: action.type,
      result
    });
  }

  throw new Error("Planner exceeded max steps");
}
