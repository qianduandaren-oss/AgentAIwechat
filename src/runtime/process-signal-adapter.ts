import { ShutdownCoordinator } from "./shutdown-coordinator.js";

export interface ProcessSignalHost {
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): void;
  exitCode?: number;
}

export interface ShutdownLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface ProcessSignalAdapterOptions {
  processHost?: ProcessSignalHost;
  logger?: ShutdownLogger;
}

/** Thin adapter: process signals trigger the already-tested shutdown coordinator. */
export function installProcessSignalAdapter(
  coordinator: ShutdownCoordinator,
  options: ProcessSignalAdapterOptions = {},
): void {
  const processHost = options.processHost ?? process;
  const logger = options.logger ?? console;

  const onSignal = (signal: "SIGTERM" | "SIGINT") => {
    logger.info(`[shutdown] received ${signal}`);

    void coordinator.shutdown().catch((error: unknown) => {
      processHost.exitCode = 1;
      logger.error("[shutdown] graceful shutdown failed", error);
    });
  };

  processHost.once("SIGTERM", () => onSignal("SIGTERM"));
  processHost.once("SIGINT", () => onSignal("SIGINT"));
}
