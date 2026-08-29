import { callLLM } from "../llm/client.js";
import { extractStructured } from "../llm/response-parser.js";
import type { LLMProvider } from "../llm/types.js";
import type { Planner } from "./planner.js";
import {
  PLANNER_ACTION_SCHEMA,
  PLANNER_ACTION_SPACE
} from "./schema.js";
import type { PlannerAction, PlannerState } from "./types.js";
import { parsePlannerAction } from "./validation.js";

export interface LLMPlannerOptions {
  validationRetries?: number;
}

function buildPlannerPrompt(
  state: PlannerState,
  validationFeedback: string[]
): string {
  const observations = JSON.stringify(state.observations, null, 2);
  const reflectionNotes = state.reflectionNotes.length
    ? state.reflectionNotes.join("\n- ")
    : "none";
  const validationNotes = validationFeedback.length
    ? validationFeedback.join("\n- ")
    : "none";

  return [
    `Goal: ${state.goal}`,
    `Step: ${state.step}`,
    `Allowed actions: ${PLANNER_ACTION_SPACE.join(", ")}`,
    `Observations:\n${observations}`,
    `Reflection notes:\n- ${reflectionNotes}`,
    `Validation feedback from previous attempts:\n- ${validationNotes}`,
    "Choose exactly one next action. Use finish only when the observations are sufficient to answer the goal."
  ].join("\n\n");
}

export class LLMPlanner implements Planner {
  private readonly validationRetries: number;

  constructor(
    private readonly provider: LLMProvider,
    options: LLMPlannerOptions = {}
  ) {
    this.validationRetries = options.validationRetries ?? 2;
  }

  async planNext(state: PlannerState): Promise<PlannerAction> {
    const validationFeedback: string[] = [];

    for (let attempt = 0; attempt <= this.validationRetries; attempt++) {
      const raw = await callLLM(this.provider, {
        task: "planner_next_action",
        messages: [
          {
            role: "system",
            content:
              "You are a planner. Return one structured action only. Never invent actions outside the allowed action space."
          },
          {
            role: "user",
            content: buildPlannerPrompt(state, validationFeedback)
          }
        ],
        responseSchema: PLANNER_ACTION_SCHEMA,
        context: {
          plannerState: state,
          validationFeedback,
          actionSpace: [...PLANNER_ACTION_SPACE]
        }
      });

      try {
        const candidate = extractStructured<unknown>(raw);
        return parsePlannerAction(candidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        validationFeedback.push(`Attempt ${attempt + 1}: ${message}`);
      }
    }

    throw new Error(
      `LLM Planner could not produce a valid action: ${validationFeedback.join(" | ")}`
    );
  }
}
