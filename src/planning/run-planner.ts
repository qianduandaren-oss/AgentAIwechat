import { createActionKey } from "./action-key.js";
import { executeAction } from "./executor.js";
import { CustomerPlanner, type Planner } from "./planner.js";
import {
  reflectAction,
  reflectObservation
} from "./reflection.js";
import type { PlannerAction, PlannerState } from "./types.js";

export const MAX_PLANNER_STEPS = 6;

export interface RunPlannerOptions {
  planner?: Planner;
  execute?: (action: PlannerAction) => Promise<unknown>;
  maxSteps?: number;
}

export async function runPlanner(
  goal: string,
  options: RunPlannerOptions = {}
): Promise<string> {
  if (!goal.trim()) {
    throw new Error("Planner goal cannot be empty");
  }

  const planner = options.planner ?? new CustomerPlanner();
  const execute = options.execute ?? executeAction;
  const maxSteps = options.maxSteps ?? MAX_PLANNER_STEPS;

  const state: PlannerState = {
    goal,
    observations: [],
    step: 0,
    visitedActions: [],
    reflectionNotes: []
  };

  while (state.step < maxSteps) {
    state.step++;

    const action = await planner.planNext(state);
    const reflection = reflectAction(state, action);

    console.log(`\nStep ${state.step}`);
    console.log("Action:", action.type);

    if (!reflection.allowed) {
      const reason = reflection.reason ?? "Action rejected by reflection";
      state.reflectionNotes.push(reason);
      console.warn("Reflection:", reason);
      continue;
    }

    if (action.type === "finish") {
      console.log("Answer:", action.input.answer);
      return action.input.answer;
    }

    state.visitedActions.push(createActionKey(action));

    const result = await execute(action);
    console.log("Observation:", result);

    state.observations.push({
      action: action.type,
      result
    });

    const observationReflection = reflectObservation(result);
    if (!observationReflection.useful && observationReflection.note) {
      state.reflectionNotes.push(observationReflection.note);
      console.warn("Reflection:", observationReflection.note);
    }
  }

  throw new Error(
    `Planner exceeded max steps. Reflection notes: ${state.reflectionNotes.join(" | ")}`
  );
}
