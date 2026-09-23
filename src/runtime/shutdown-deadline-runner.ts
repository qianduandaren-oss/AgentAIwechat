export type ShutdownDeadlineStatus = "completed" | "failed" | "deadline_exceeded";

export type ShutdownDeadlineResult =
  | { status: "completed"; elapsedMs: number }
  | { status: "failed"; elapsedMs: number; error: unknown }
  | { status: "deadline_exceeded"; elapsedMs: number };

export interface ShutdownTarget {
  shutdown(): Promise<void>;
}

export interface ShutdownDeadlineOptions {
  timeoutMs: number;
  now?: () => number;
}

/**
 * Applies a host waiting budget to shutdown without pretending that a timeout
 * cancels the underlying shutdown work.
 */
export async function runShutdownWithDeadline(
  target: ShutdownTarget,
  options: ShutdownDeadlineOptions,
): Promise<ShutdownDeadlineResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error("timeoutMs must be a finite non-negative number");
  }

  const now = options.now ?? Date.now;
  const startedAt = now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline_exceeded">((resolve) => {
    timer = setTimeout(() => resolve("deadline_exceeded"), options.timeoutMs);
  });

  const shutdown = target.shutdown().then(
    () => "completed" as const,
    (error: unknown) => ({ status: "failed" as const, error }),
  );

  const outcome = await Promise.race([shutdown, deadline]);
  if (timer) clearTimeout(timer);
  const elapsedMs = Math.max(0, now() - startedAt);

  if (outcome === "completed") return { status: "completed", elapsedMs };
  if (outcome === "deadline_exceeded") {
    return { status: "deadline_exceeded", elapsedMs };
  }
  return { status: "failed", elapsedMs, error: outcome.error };
}
