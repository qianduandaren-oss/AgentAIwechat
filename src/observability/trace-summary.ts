import type { AgentTrace, TraceSpan } from "./trace-types.js";

export interface TraceSummary {
  traceId: string;
  totalDurationMs: number;
  llmCalls: number;
  toolCalls: number;
  errorCount: number;
  slowestSpan?: {
    name: string;
    kind: TraceSpan["kind"];
    durationMs: number;
  };
}

export function summarizeTrace(trace: AgentTrace): TraceSummary {
  const completed = trace.spans.filter(span => span.durationMs !== undefined);
  const root = completed.find(span => span.kind === "agent");
  const slowest = completed
    .filter(span => span.kind !== "agent")
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];

  return {
    traceId: trace.traceId,
    totalDurationMs: root?.durationMs ?? 0,
    llmCalls: trace.spans.filter(span => span.kind === "llm").length,
    toolCalls: trace.spans.filter(span => span.kind === "tool").length,
    errorCount: trace.spans.filter(span => span.status === "error").length,
    ...(slowest
      ? {
          slowestSpan: {
            name: slowest.name,
            kind: slowest.kind,
            durationMs: slowest.durationMs ?? 0
          }
        }
      : {})
  };
}
