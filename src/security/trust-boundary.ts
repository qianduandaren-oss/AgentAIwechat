export type ContentTrustLevel = "trusted_instruction" | "untrusted_data";

export type ContentSource =
  | "system"
  | "developer"
  | "user"
  | "rag_document"
  | "web_page"
  | "tool_result";

export interface RuntimeContent {
  source: ContentSource;
  trust: ContentTrustLevel;
  content: string;
}

export function classifyContent(
  source: ContentSource,
  content: string
): RuntimeContent {
  const trust: ContentTrustLevel =
    source === "system" || source === "developer"
      ? "trusted_instruction"
      : "untrusted_data";

  return { source, trust, content };
}

export function canProvideRuntimeInstruction(content: RuntimeContent): boolean {
  return content.trust === "trusted_instruction";
}
