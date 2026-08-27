export class TransientWorkflowError extends Error {
}
export class PermanentWorkflowError extends Error {
}
export class NeedsHumanError extends Error {
}
export function classifyError(error) {
    if (error instanceof TransientWorkflowError)
        return "TRANSIENT";
    if (error instanceof NeedsHumanError)
        return "NEEDS_HUMAN";
    return "PERMANENT";
}
