export class TransientWorkflowError extends Error {}
export class PermanentWorkflowError extends Error {}
export class NeedsHumanError extends Error {}

export type ErrorType = "TRANSIENT" | "PERMANENT" | "NEEDS_HUMAN";

export function classifyError(error: unknown): ErrorType {
  if (error instanceof TransientWorkflowError) return "TRANSIENT";
  if (error instanceof NeedsHumanError) return "NEEDS_HUMAN";
  return "PERMANENT";
}
