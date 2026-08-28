export type PlanStepStatus = "pending" | "running" | "done" | "failed";

export type PlanningAction =
  | {
      type: "search_customer";
      customerName: string;
    }
  | {
      type: "search_chat_history";
      customerId: string;
    }
  | {
      type: "search_order";
      customerId: string;
    }
  | {
      type: "search_knowledge";
      query: string;
    }
  | {
      type: "create_followup_plan";
      customerId: string;
    }
  | {
      type: "finish";
      answer: string;
    };

export type PlanningActionType = PlanningAction["type"];

export interface PlanStep {
  id: string;
  action: PlanningAction;
  reason: string;
  status: PlanStepStatus;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface Observation {
  stepId: string;
  action: PlanningActionType;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentError {
  stepId: string;
  action: PlanningActionType;
  message: string;
}

export interface AgentState {
  goal: string;
  completedSteps: PlanStep[];
  pendingSteps: PlanStep[];
  observations: Observation[];
  errors: AgentError[];
  iteration: number;
}

export interface PlanningDecision {
  action: PlanningAction;
  reason: string;
}

export interface PlanningRunResult {
  state: AgentState;
  answer: string;
}
