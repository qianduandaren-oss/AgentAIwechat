import { createId } from "../shared/utils.js";
import type {
  AgentTrace,
  TraceSpan,
  TraceSpanKind,
  TraceSpanStatus
} from "./trace-types.js";

export interface StartSpanInput {
  name: string;
  kind: TraceSpanKind;
  parentSpanId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export class TraceRecorder {
  private readonly trace: AgentTrace;
  private readonly rootId: string;

  constructor(goal: string) {
    const traceId = createId("trace");
    this.rootId = createId("span");
    this.trace = {
      traceId,
      goal,
      spans: [
        {
          traceId,
          spanId: this.rootId,
          name: "agent.run",
          kind: "agent",
          startTime: Date.now(),
          status: "ok"
        }
      ]
    };
  }

  get traceId(): string {
    return this.trace.traceId;
  }

  get rootSpanId(): string {
    return this.rootId;
  }

  startSpan(input: StartSpanInput): string {
    const spanId = createId("span");
    this.trace.spans.push({
      traceId: this.trace.traceId,
      spanId,
      parentSpanId: input.parentSpanId ?? this.rootId,
      name: input.name,
      kind: input.kind,
      startTime: Date.now(),
      status: "ok",
      attributes: input.attributes ? { ...input.attributes } : undefined
    });
    return spanId;
  }

  endSpan(
    spanId: string,
    status: TraceSpanStatus = "ok",
    error?: unknown,
    attributes?: Record<string, string | number | boolean>
  ): void {
    const span = this.trace.spans.find(item => item.spanId === spanId);
    if (!span || span.endTime !== undefined) return;

    const endTime = Date.now();
    span.endTime = endTime;
    span.durationMs = endTime - span.startTime;
    span.status = status;
    if (error !== undefined) {
      span.error = error instanceof Error ? error.message : String(error);
    }
    if (attributes) {
      span.attributes = { ...(span.attributes ?? {}), ...attributes };
    }
  }

  finish(status: TraceSpanStatus = "ok", error?: unknown): AgentTrace {
    for (const span of this.trace.spans) {
      if (span.endTime === undefined && span.spanId !== this.rootId) {
        this.endSpan(span.spanId, span.status);
      }
    }
    this.endSpan(this.rootId, status, error);
    return this.snapshot();
  }

  snapshot(): AgentTrace {
    return {
      traceId: this.trace.traceId,
      goal: this.trace.goal,
      spans: this.trace.spans.map((span: TraceSpan) => ({
        ...span,
        attributes: span.attributes ? { ...span.attributes } : undefined
      }))
    };
  }
}
