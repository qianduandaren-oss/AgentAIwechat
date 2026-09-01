export type TrajectoryEventType =
  | "llm_turn"
  | "tool_call"
  | "tool_result"
  | "final_answer";

export interface TrajectoryEvent {
  step: number;
  type: TrajectoryEventType;
  name?: string;
  toolCallId?: string;
  content?: string;
}

export interface AgentTrajectory {
  goal: string;
  events: TrajectoryEvent[];
  totalSteps: number;
}

export interface TrajectoryExpectation {
  requiredTools?: string[];
  forbiddenTools?: string[];
  maxSteps?: number;
}

export interface TrajectoryEvalCase {
  id: string;
  goal: string;
  expectation: TrajectoryExpectation;
  tags?: string[];
}
