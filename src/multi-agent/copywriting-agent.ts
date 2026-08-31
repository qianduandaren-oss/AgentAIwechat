import type { DelegationResult, DelegationTask } from "./types.js";

export interface CopywritingInput {
  customerId: string;
  brief?: string;
}

export interface CopywritingOutput {
  customerId: string;
  draft: string;
}

export async function runCopywritingAgent(
  task: DelegationTask<CopywritingInput>
): Promise<DelegationResult<CopywritingOutput>> {
  return {
    taskId: task.id,
    agentId: task.toAgentId,
    success: true,
    output: {
      customerId: task.input.customerId,
      draft: task.input.brief
        ? `根据客户关注的${task.input.brief}生成跟进草稿。`
        : "根据当前客户上下文生成跟进草稿。"
    }
  };
}
