import type { AgentToolCall } from "../llm/types.js";
import type { SecureToolExecutor } from "../security/secure-tool-executor.js";
import { ToolRegistry } from "./registry.js";

export interface ToolExecutionOptions {
  secureExecutor?: SecureToolExecutor;
  approvedActionId?: string;
  signal?: AbortSignal;
}

export async function executeTool(
  registry: ToolRegistry,
  toolCall: AgentToolCall,
  options: ToolExecutionOptions = {}
): Promise<unknown> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Tool execution cancelled");
  }

  if (options.secureExecutor) {
    // SecureToolExecutor does not yet expose a signal-aware contract. The
    // surrounding Agent Loop still prevents new secure tool calls after abort.
    return options.secureExecutor.execute(toolCall, options.approvedActionId);
  }

  const registered = registry.get(toolCall.name);
  if (!registered) {
    throw new Error(`Unknown tool: ${toolCall.name}`);
  }
  return registered.handler(toolCall.arguments, { signal: options.signal });
}
