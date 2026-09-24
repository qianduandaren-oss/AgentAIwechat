export class AgentRunCancelledError extends Error {
  readonly code = "RUN_CANCELLED";

  constructor(message = "Agent run cancelled") {
    super(message);
    this.name = "AgentRunCancelledError";
  }
}

export function throwIfRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentRunCancelledError();
  }
}
