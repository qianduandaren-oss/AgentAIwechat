export type TraceSpanKind = "agent" | "llm" | "tool";
export type TraceSpanStatus = "ok" | "error";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: TraceSpanKind;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: TraceSpanStatus;
  attributes?: Record<string, string | number | boolean>;
  error?: string;
}

export interface AgentTrace {
  traceId: string;
  goal: string;
  spans: TraceSpan[];
}
