import type { LLMProvider, LLMRequest } from "./types.js";

/**
 * Day 1-2 缺失的核心函数之一。
 * Agent 层只依赖 callLLM，不直接依赖某一家模型 SDK。
 */
export async function callLLM(
  provider: LLMProvider,
  request: LLMRequest
): Promise<unknown> {
  return provider.generate(request);
}
