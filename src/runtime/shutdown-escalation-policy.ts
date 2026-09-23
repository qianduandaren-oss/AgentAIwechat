import { runShutdownWithDeadline, type ShutdownDeadlineResult, type ShutdownTarget } from "./shutdown-deadline-runner.js";

export interface ShutdownEscalationLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface ShutdownExitHost {
  exitCode?: number;
}

export interface ShutdownEscalationOptions {
  timeoutMs: number;
  exitHost?: ShutdownExitHost;
  logger?: ShutdownEscalationLogger;
}

/**
 * Host-level policy for shutdown outcomes. It never claims to cancel the
 * underlying shutdown or running Agent work when the deadline is exceeded.
 */
export async function runShutdownWithEscalation(
  target: ShutdownTarget,
  options: ShutdownEscalationOptions,
): Promise<ShutdownDeadlineResult> {
  const exitHost = options.exitHost ?? process;
  const logger = options.logger ?? console;
  const result = await runShutdownWithDeadline(target, { timeoutMs: options.timeoutMs });

  switch (result.status) {
    case "completed":
      logger.info(`[shutdown] completed in ${result.elapsedMs}ms`);
      return result;
    case "failed":
      exitHost.exitCode = 1;
      logger.error(`[shutdown] failed after ${result.elapsedMs}ms`, result.error);
      return result;
    case "deadline_exceeded":
      exitHost.exitCode = 1;
      logger.error(`[shutdown] deadline exceeded after ${result.elapsedMs}ms; underlying shutdown may still be running`);
      return result;
  }
}
