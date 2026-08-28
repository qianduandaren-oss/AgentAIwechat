import type {
  Observation,
  PlanningAction,
  PlanningDecision
} from "./types.js";
import { assertActionAllowed } from "./policy.js";

export interface PlanningToolHandlers {
  search_customer(input: { customerName: string }): Promise<unknown>;
  search_chat_history(input: { customerId: string }): Promise<unknown>;
  search_order(input: { customerId: string }): Promise<unknown>;
  search_knowledge(input: { query: string }): Promise<unknown>;
  create_followup_plan(input: { customerId: string }): Promise<unknown>;
}

export class PlanningExecutor {
  constructor(private readonly handlers: PlanningToolHandlers) {}

  async execute(stepId: string, decision: PlanningDecision): Promise<Observation> {
    const action = decision.action;
    assertActionAllowed(action);

    if (action.type === "finish") {
      return {
        stepId,
        action: action.type,
        ok: true,
        data: { answer: action.answer }
      };
    }

    try {
      const data = await this.executeAction(action);
      return {
        stepId,
        action: action.type,
        ok: true,
        data
      };
    } catch (error) {
      return {
        stepId,
        action: action.type,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeAction(action: Exclude<PlanningAction, { type: "finish" }>): Promise<unknown> {
    switch (action.type) {
      case "search_customer":
        return this.handlers.search_customer({ customerName: action.customerName });
      case "search_chat_history":
        return this.handlers.search_chat_history({ customerId: action.customerId });
      case "search_order":
        return this.handlers.search_order({ customerId: action.customerId });
      case "search_knowledge":
        return this.handlers.search_knowledge({ query: action.query });
      case "create_followup_plan":
        return this.handlers.create_followup_plan({ customerId: action.customerId });
    }
  }
}
