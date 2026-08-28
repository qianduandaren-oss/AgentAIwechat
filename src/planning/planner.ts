import { PlanningExecutor } from "./executor.js";
import { assertDecisionAllowed } from "./policy.js";
import type {
  AgentState,
  Observation,
  PlanStep,
  PlanningDecision,
  PlanningRunResult
} from "./types.js";

export type PlanningDecisionProvider = (
  state: Readonly<AgentState>
) => Promise<PlanningDecision>;

export class Planner {
  constructor(
    private readonly decideNextAction: PlanningDecisionProvider,
    private readonly maxSteps = 8
  ) {}

  createState(goal: string): AgentState {
    if (!goal.trim()) {
      throw new Error("Planning goal cannot be empty.");
    }

    return {
      goal,
      completedSteps: [],
      pendingSteps: [],
      observations: [],
      errors: [],
      iteration: 0
    };
  }

  async next(state: AgentState): Promise<PlanningDecision> {
    if (state.iteration >= this.maxSteps) {
      return {
        action: {
          type: "finish",
          answer: "Planning stopped because the maximum number of steps was reached."
        },
        reason: "Stop the loop before the Agent can keep planning indefinitely."
      };
    }

    const decision = await this.decideNextAction(state);
    assertDecisionAllowed(decision);
    return decision;
  }

  applyObservation(
    state: AgentState,
    step: PlanStep,
    observation: Observation
  ): AgentState {
    const completedStep: PlanStep = {
      ...step,
      status: observation.ok ? "done" : "failed"
    };

    return {
      ...state,
      completedSteps: [...state.completedSteps, completedStep],
      observations: [...state.observations, observation],
      errors: observation.ok
        ? state.errors
        : [
            ...state.errors,
            {
              stepId: step.id,
              action: step.action.type,
              message: observation.error ?? "Unknown planning error"
            }
          ],
      iteration: state.iteration + 1
    };
  }

  async run(goal: string, executor: PlanningExecutor): Promise<PlanningRunResult> {
    let state = this.createState(goal);

    while (true) {
      const decision = await this.next(state);
      const step: PlanStep = {
        id: `plan_step_${state.iteration + 1}`,
        action: decision.action,
        reason: decision.reason,
        status: "running"
      };

      const observation = await executor.execute(step.id, decision);
      state = this.applyObservation(state, step, observation);

      if (decision.action.type === "finish") {
        return {
          state,
          answer: decision.action.answer
        };
      }
    }
  }
}
