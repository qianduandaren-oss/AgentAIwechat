export type MessageRole = "system" | "user" | "assistant" | "tool";

export type AgentMessage = {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LLMTask =
  | "lead_analysis"
  | "memory_extract"
  | "agent_turn"
  | "intent_classification"
  | "answer_with_context";

export type LLMRequest = {
  task: LLMTask;
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  context?: Record<string, unknown>;
};

export type MockRawBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

export type MockRawLLMResponse = {
  output: MockRawBlock[];
  structured?: unknown;
};

export interface LLMProvider {
  generate(request: LLMRequest): Promise<unknown>;
}
