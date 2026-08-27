import { sleep } from "../shared/utils.js";
import { classifyError } from "./errors.js";

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
};

export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  onAttempt?: (attempt: number) => void
): Promise<T> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      onAttempt?.(attempt);
      return await fn(attempt);
    } catch (error) {
      const type = classifyError(error);
      if (type !== "TRANSIENT" || attempt >= policy.maxAttempts) throw error;
      await sleep(policy.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error("Retry exhausted");
}
