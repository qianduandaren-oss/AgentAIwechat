export type PlannerAction =
  | {
      type: "search_customer";
      input: {
        name: string;
      };
    }
  | {
      type: "search_chat_history";
      input: {
        customerId: string;
      };
    }
  | {
      type: "search_knowledge";
      input: {
        query: string;
      };
    }
  | {
      type: "finish";
      input: {
        answer: string;
      };
    };

export type PlannerActionType = PlannerAction["type"];

export interface Observation {
  action: PlannerActionType;
  result: unknown;
}

export interface PlannerState {
  goal: string;
  observations: Observation[];
  step: number;
  visitedActions: string[];
  reflectionNotes: string[];
}
