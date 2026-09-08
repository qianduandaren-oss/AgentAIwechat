import { sanitizeForLog } from "./sensitive-data.js";

export type DataBoundary = "llm" | "memory" | "trace" | "audit";

export interface BoundaryPayloads<TLLM = unknown, TMemory = unknown> {
  llm: TLLM;
  memory?: TMemory;
  trace: unknown;
  audit: unknown;
}

export function buildBoundaryPayloads<TLLM, TMemory = never>(input: {
  llm: TLLM;
  memory?: TMemory;
  trace: unknown;
  audit: unknown;
}): BoundaryPayloads<TLLM, TMemory> {
  return {
    llm: input.llm,
    ...(input.memory !== undefined ? { memory: input.memory } : {}),
    trace: sanitizeForLog(input.trace),
    audit: sanitizeForLog(input.audit)
  };
}
