export interface RoutingEvalCase {
  id: string;
  goal: string;
  expectedAgentId: string;
  tags?: string[];
}

export interface RoutingEvalResult {
  caseId: string;
  goal: string;
  expectedAgentId: string;
  actualAgentId: string;
  passed: boolean;
  reason: string;
}

export interface RoutingEvalSummary {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  results: RoutingEvalResult[];
}
