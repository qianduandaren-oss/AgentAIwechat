export type MemorySource = "user_explicit" | "user_inferred" | "tool_result" | "system";
export type MemoryType = "identity" | "preference" | "interest" | "objection";

export type MemoryCandidate = {
  type: MemoryType;
  key: string;
  value: unknown;
  confidence: number;
  source: MemorySource;
};

export type MemoryValue = MemoryCandidate & {
  createdAt: string;
  updatedAt: string;
};
