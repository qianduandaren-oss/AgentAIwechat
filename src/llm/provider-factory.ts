import type { RuntimeConfig } from "../config/runtime-config.js";
import type { LLMProvider } from "./types.js";
import { MockProvider } from "./providers/mock-provider.js";

export function createLLMProvider(config: RuntimeConfig): LLMProvider {
  switch (config.llm.provider) {
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unsupported LLM provider: ${config.llm.provider}`);
  }
}
