/** Last persisted state mutation attribution; not a complete audit log. */
export interface RecoveryCausationMetadata {
  causedByCommandId?: string;
}

export type RecoveryCausationMatch =
  | "caused_by_command"
  | "caused_by_other"
  | "unknown";

/** Older records lacking attribution stay unknown rather than being guessed. */
export function classifyRecoveryCausation(
  state: RecoveryCausationMetadata,
  commandId: string
): RecoveryCausationMatch {
  if (!state.causedByCommandId) return "unknown";
  return state.causedByCommandId === commandId
    ? "caused_by_command"
    : "caused_by_other";
}

/** Call only for state objects actually mutated by this command. */
export function bindRecoveryCausation<T extends RecoveryCausationMetadata>(
  nextState: T,
  commandId: string
): T {
  if (!commandId.trim()) {
    throw new Error("Durable recovery causation requires a commandId");
  }
  return {
    ...structuredClone(nextState),
    causedByCommandId: commandId
  };
}
