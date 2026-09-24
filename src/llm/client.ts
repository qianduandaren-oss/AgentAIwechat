import type { LLMGenerateOptions, LLMProvider, LLMRequest } from "./types.js";

/**
 * Agent 层只依赖 callLLM，不直接依赖某一家模型 SDK。
 * Cancellation 也通过统一 Provider contract 向下传播。
 */
export async function callLLM(
  provider: LLMProvider,
  request: LLMRequest,
  options: LLMGenerateOptions = {}
): Promise<unknown> {
  return provider.generate(request, options);
}
