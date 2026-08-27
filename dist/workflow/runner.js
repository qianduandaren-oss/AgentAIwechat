import { executeWithRetry } from "./retry.js";
import { classifyError } from "./errors.js";
import { getNextStep } from "./transitions.js";
const retryPolicies = {
    LOAD_CUSTOMER: { maxAttempts: 2, baseDelayMs: 10 },
    CHECK_INTENT: { maxAttempts: 2, baseDelayMs: 10 },
    CHECK_FOLLOWUP: { maxAttempts: 2, baseDelayMs: 10 },
    CREATE_FOLLOWUP: { maxAttempts: 3, baseDelayMs: 10 },
    WRITE_LOG: { maxAttempts: 3, baseDelayMs: 10 },
    SEND_NOTIFICATION: { maxAttempts: 2, baseDelayMs: 10 }
};
function record(state, step, status, attempt, error) {
    const previous = state.steps[step];
    state.steps[step] = {
        step,
        status,
        attempt,
        startedAt: previous?.startedAt ?? new Date().toISOString(),
        finishedAt: status === "running" ? undefined : new Date().toISOString(),
        error
    };
}
export async function runWorkflow(initialState, nodes, store) {
    let state = initialState;
    await store.save(state);
    while (!["DONE", "FAILED", "WAITING_APPROVAL"].includes(state.currentStep)) {
        const step = state.currentStep;
        const node = nodes[step];
        if (!node)
            throw new Error(`Node not found: ${step}`);
        const policy = retryPolicies[step] ?? { maxAttempts: 1, baseDelayMs: 0 };
        try {
            state = await executeWithRetry(async (attempt) => {
                record(state, step, "running", attempt);
                await store.save(state);
                const nextState = await node(state);
                record(nextState, step, "success", attempt);
                return nextState;
            }, policy);
            state.history.push(step);
            state.currentStep = getNextStep(state);
            await store.save(state);
        }
        catch (error) {
            const type = classifyError(error);
            const message = error instanceof Error ? error.message : String(error);
            const attempt = state.steps[step]?.attempt ?? 1;
            record(state, step, "failed", attempt, message);
            state.error = { step, message };
            state.currentStep = type === "NEEDS_HUMAN" ? "WAITING_APPROVAL" : "FAILED";
            await store.save(state);
        }
    }
    return state;
}
