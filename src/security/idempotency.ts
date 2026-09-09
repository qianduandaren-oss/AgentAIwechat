import type { AgentToolCall } from "../llm/types.js";

export interface IdempotencyRecord {
  key: string;
  result: unknown;
  createdAt: number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(input: string): string {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function createIdempotencyKey(toolCall: AgentToolCall, actionId?: string): string {
  const payload = `${toolCall.name}:${stableStringify(toolCall.arguments)}:${actionId ?? toolCall.id}`;
  return `idem_${hash(payload)}`;
}

export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    return record ? { ...record } : undefined;
  }

  save(key: string, result: unknown): IdempotencyRecord {
    const existing = this.records.get(key);
    if (existing) return { ...existing };

    const record: IdempotencyRecord = {
      key,
      result,
      createdAt: Date.now()
    };
    this.records.set(key, record);
    return { ...record };
  }
}
