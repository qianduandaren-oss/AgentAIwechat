export type TokenUsageSource = "provider" | "estimated";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: TokenUsageSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

export function extractProviderTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  if (!usage) return undefined;

  const inputTokens = readNumber(usage, ["input_tokens", "prompt_tokens", "inputTokens"]);
  const outputTokens = readNumber(usage, ["output_tokens", "completion_tokens", "outputTokens"]);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "provider"
  };
}

export function estimateTokenCount(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function resolveTokenUsage(input: unknown, raw: unknown): TokenUsage {
  return (
    extractProviderTokenUsage(raw) ?? {
      inputTokens: estimateTokenCount(input),
      outputTokens: estimateTokenCount(raw),
      totalTokens: estimateTokenCount(input) + estimateTokenCount(raw),
      source: "estimated"
    }
  );
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    source: a.source === "provider" && b.source === "provider" ? "provider" : "estimated"
  };
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  source: "provider"
};
