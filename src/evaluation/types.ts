export type RoutingEvalFailureKind =
  | "routing_error"
  | "execution_error"
  | "evaluation_data_error";

export interface RoutingEvalCase {
  id: string;
  goal: string;
  expectedAgentId: string;
  tags?: string[];
  note?: string;
}

export interface RoutingEvalResult {
  caseId: string;
  goal: string;
  expectedAgentId: string;
  actualAgentId: string;
  passed: boolean;
  reason: string;
  failureKind?: RoutingEvalFailureKind;
  tags?: string[];
}

export interface RoutingEvalSummary {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  failuresByKind: Record<RoutingEvalFailureKind, number>;
  results: RoutingEvalResult[];
}
