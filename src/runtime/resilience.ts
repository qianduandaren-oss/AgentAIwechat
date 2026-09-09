export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
}

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  shouldRetry: (error: unknown) => boolean
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= policy.maxRetries || !shouldRetry(error)) throw error;
      const delayMs = policy.baseDelayMs * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}
