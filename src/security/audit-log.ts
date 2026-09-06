export type AuditOutcome = "allowed" | "denied" | "executed" | "failed";

export type AuditEvent = {
  id: string;
  timestamp: number;
  actorId: string;
  agentId: string;
  action: string;
  resourceId: string;
  resourceType: string;
  outcome: AuditOutcome;
  reason?: string;
  policy?: string;
  traceId?: string;
};

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  list(): Promise<AuditEvent[]>;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async list(): Promise<AuditEvent[]> {
    return this.events.map(event => ({ ...event }));
  }
}

export function createAuditEvent(input: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...input
  };
}
