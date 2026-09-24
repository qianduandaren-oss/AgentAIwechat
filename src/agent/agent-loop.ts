import { callLLM } from "../llm/client.js";
import { extractText, extractToolCalls } from "../llm/response-parser.js";
import type { AgentMessage, AgentToolCall, LLMProvider, LLMRequest } from "../llm/types.js";
import { calculateCost, type ModelPricing, ZERO_PRICING } from "../observability/model-pricing.js";
import { BudgetGuard } from "../observability/budget-guard.js";
import { TraceRecorder } from "../observability/trace-recorder.js";
import { summarizeTrace, type TraceSummary } from "../observability/trace-summary.js";
import { addTokenUsage, EMPTY_TOKEN_USAGE, resolveTokenUsage, type TokenUsage } from "../observability/token-usage.js";
import type { AgentTrace } from "../observability/trace-types.js";
import type { SecureToolExecutor } from "../security/secure-tool-executor.js";
import { sanitizeForLog } from "../security/sensitive-data.js";
import { executeTool } from "../tools/executor.js";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentTrajectory, TrajectoryEvent } from "../evaluation/trajectory-types.js";
import type { AgentRunBudget, AgentRunBudgetLimit } from "../runtime/run-budget.js";
import { evaluateBudgetPolicy, type BudgetPolicyDecision } from "../runtime/budget-policy.js";
import { throwIfRunCancelled } from "../runtime/run-cancellation.js";

export type AgentLoopResult = {
  text: string; messages: AgentMessage[]; steps: number; trajectory: AgentTrajectory;
  trace: AgentTrace; traceSummary: TraceSummary; usage: TokenUsage; estimatedCostUsd: number;
};

export interface AgentLoopRuntimeOptions {
  traceRecorder?: TraceRecorder;
  pricing?: ModelPricing;
  budgetGuard?: BudgetGuard;
  runBudget?: AgentRunBudget;
  runBudgetLimit?: AgentRunBudgetLimit;
  budgetWarningThreshold?: number;
  secureToolExecutor?: SecureToolExecutor;
  approvedActionResolver?: (toolCall: AgentToolCall) => string | undefined;
  toolResultProjector?: (result: unknown, toolCall: AgentToolCall) => unknown;
  llmInvoker?: (provider: LLMProvider, request: LLMRequest) => Promise<unknown>;
  signal?: AbortSignal;
}

function getBudgetDecision(runtime: AgentLoopRuntimeOptions): BudgetPolicyDecision | undefined {
  if (!runtime.runBudget || !runtime.runBudgetLimit) return undefined;
  return evaluateBudgetPolicy(runtime.runBudget.snapshot(), runtime.runBudgetLimit, runtime.budgetWarningThreshold);
}

async function invokeLLM(provider: LLMProvider, request: LLMRequest, runtime: AgentLoopRuntimeOptions): Promise<unknown> {
  throwIfRunCancelled(runtime.signal);
  return runtime.llmInvoker ? runtime.llmInvoker(provider, request) : callLLM(provider, request);
}

export async function runAgentLoop(provider: LLMProvider, registry: ToolRegistry, userMessage: string, maxSteps = 6, runtime: AgentLoopRuntimeOptions = {}): Promise<AgentLoopResult> {
  const messages: AgentMessage[] = [{ role: "user", content: userMessage }];
  const events: TrajectoryEvent[] = [];
  const recorder = runtime.traceRecorder ?? new TraceRecorder(userMessage);
  const pricing = runtime.pricing ?? ZERO_PRICING;
  let usage: TokenUsage = { ...EMPTY_TOKEN_USAGE };
  let estimatedCostUsd = 0;

  const finish = (text: string, step: number): AgentLoopResult => {
    events.push({ step, type: "final_answer", content: text });
    const trace = recorder.finish("ok");
    return { text, messages, steps: step, trajectory: { goal: userMessage, events, totalSteps: step }, trace, traceSummary: summarizeTrace(trace), usage, estimatedCostUsd };
  };

  const closeWithExistingContext = async (step: number): Promise<AgentLoopResult> => {
    throwIfRunCancelled(runtime.signal);
    const budgetBeforeClosing = getBudgetDecision(runtime);
    if (budgetBeforeClosing?.state === "exhausted" || budgetBeforeClosing?.shouldFinish) throw new Error("Agent budget exhausted before closing response");
    const request: LLMRequest = { task: "agent_finalize", messages: [...messages, { role: "system", content: "Budget is limited. Do not call tools. Answer now using only the information already available in this conversation and tool observations." }], tools: [] };
    const spanId = recorder.startSpan({ name: `llm.closing.${step}`, kind: "llm", attributes: { step, mode: "closing", budgetState: budgetBeforeClosing?.state } });
    let raw: unknown;
    try { raw = await invokeLLM(provider, request, runtime); }
    catch (error) { recorder.endSpan(spanId, "error", error); throw error; }
    throwIfRunCancelled(runtime.signal);
    const turnUsage = resolveTokenUsage(request, raw);
    const turnCost = calculateCost(turnUsage, pricing);
    usage = addTokenUsage(usage, turnUsage); estimatedCostUsd += turnCost.totalCostUsd;
    runtime.runBudget?.recordModelCall(turnUsage, pricing); runtime.budgetGuard?.consume(turnUsage, pricing);
    const budgetAfterClosing = getBudgetDecision(runtime);
    recorder.endSpan(spanId, "ok", undefined, { inputTokens: turnUsage.inputTokens, outputTokens: turnUsage.outputTokens, totalTokens: turnUsage.totalTokens, estimatedCostUsd: turnCost.totalCostUsd, mode: "closing", budgetState: budgetAfterClosing?.state, budgetUsageRatio: budgetAfterClosing?.usageRatio });
    return finish(extractText(raw), step);
  };

  try {
    for (let step = 1; step <= maxSteps; step++) {
      throwIfRunCancelled(runtime.signal);
      runtime.runBudget?.recordStep();
      events.push({ step, type: "llm_turn" });
      const budgetBeforeLLM = getBudgetDecision(runtime);
      if (budgetBeforeLLM?.shouldFinish) throw new Error("Agent budget policy requested finish before LLM call");
      const request: LLMRequest = { task: "agent_turn", messages, tools: registry.listDefinitions() };
      const llmSpanId = recorder.startSpan({ name: `llm.turn.${step}`, kind: "llm", attributes: { step, budgetState: budgetBeforeLLM?.state } });
      let raw: unknown;
      try { raw = await invokeLLM(provider, request, runtime); }
      catch (error) { recorder.endSpan(llmSpanId, "error", error); throw error; }
      throwIfRunCancelled(runtime.signal);
      const turnUsage = resolveTokenUsage(request, raw);
      const turnCost = calculateCost(turnUsage, pricing);
      usage = addTokenUsage(usage, turnUsage); estimatedCostUsd += turnCost.totalCostUsd;
      runtime.runBudget?.recordModelCall(turnUsage, pricing); runtime.budgetGuard?.consume(turnUsage, pricing);
      const budgetAfterLLM = getBudgetDecision(runtime);
      recorder.endSpan(llmSpanId, "ok", undefined, { inputTokens: turnUsage.inputTokens, outputTokens: turnUsage.outputTokens, totalTokens: turnUsage.totalTokens, estimatedCostUsd: turnCost.totalCostUsd, budgetState: budgetAfterLLM?.state, budgetUsageRatio: budgetAfterLLM?.usageRatio });
      const calls = extractToolCalls(raw);
      if (calls.length === 0) return finish(extractText(raw), step);
      if (budgetAfterLLM?.state === "warning" && !budgetAfterLLM.allowExtraRetrieval) return closeWithExistingContext(step);
      if (budgetAfterLLM?.shouldFinish) throw new Error("Agent budget policy requested finish before tool execution");

      for (const call of calls) {
        throwIfRunCancelled(runtime.signal);
        events.push({ step, type: "tool_call", name: call.name, toolCallId: call.id });
        const toolSpanId = recorder.startSpan({ name: `tool.${call.name}`, kind: "tool", attributes: { step, tool: call.name } });
        let result: unknown;
        try {
          result = await executeTool(registry, call, { secureExecutor: runtime.secureToolExecutor, approvedActionId: runtime.approvedActionResolver?.(call) });
          recorder.endSpan(toolSpanId, "ok");
        } catch (error) { recorder.endSpan(toolSpanId, "error", error); throw error; }
        throwIfRunCancelled(runtime.signal);
        const projected = runtime.toolResultProjector ? runtime.toolResultProjector(result, call) : result;
        const safeForTrace = sanitizeForLog(projected);
        events.push({ step, type: "tool_result", name: call.name, toolCallId: call.id, content: JSON.stringify(safeForTrace) });
        messages.push({ role: "assistant", name: call.name, toolCallId: call.id, content: JSON.stringify({ toolCall: call }) });
        messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: JSON.stringify(projected) });
      }
    }
    throw new Error(`Agent exceeded maxSteps=${maxSteps}`);
  } catch (error) {
    recorder.finish("error", error);
    throw error;
  }
}
