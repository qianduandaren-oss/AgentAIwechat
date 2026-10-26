import type {
  DurableRecoveryOperationCommand,
  DurableRecoveryOperationExecution
} from "./durable-recovery-operation-orchestrator.js";
import type { AtomicControlOnlyExecution } from "./recovery-atomic-control-only-adapter.js";

/**
 * Composition boundary ONLY. No production Recovery HTTP route is wired here.
 * Select ownership before any admission, authorization, tool call or legacy write.
 * An atomic failure MUST NEVER invoke the legacy handler as a fallback.
 */
export interface RecoveryEntryHandlers {
  legacy: {
    execute(command: DurableRecoveryOperationCommand): Promise<DurableRecoveryOperationExecution>;
  };
  atomic: {
    execute(
      command: DurableRecoveryOperationCommand,
      atomicControlOnlyEnabled: boolean
    ): Promise<AtomicControlOnlyExecution>;
  };
}

export type RecoveryEntryExecution =
  | { route: "legacy"; execution: DurableRecoveryOperationExecution }
  | {
      route: "atomic_control_only";
      execution: Exclude<
        AtomicControlOnlyExecution,
        { action: "legacy_unchanged" | "unsupported_atomic_operation" }
      >;
    };

export class AtomicRecoveryOperationUnsupportedError extends Error {
  constructor(operation: DurableRecoveryOperationCommand["operation"]) {
    super(`Atomic Control-only entry does not support operation: ${operation}`);
    this.name = "AtomicRecoveryOperationUnsupportedError";
  }
}

function isAtomicControlOnly(
  operation: DurableRecoveryOperationCommand["operation"]
): boolean {
  return operation === "quarantine" ||
    operation === "release_quarantine" ||
    operation === "dead_letter";
}

/**
 * A flag is captured per dispatcher instance (an immutable routing decision).
 * When enabled, unsupported operations fail closed instead of crossing to
 * a second terminal writer. Deployment policy for other operations is
 * deliberately out of scope pending production-entry wiring.
 */
export class RecoveryEntryDispatcher {
  constructor(
    private readonly handlers: RecoveryEntryHandlers,
    private readonly atomicControlOnlyEnabled: boolean
  ) {}

  async execute(command: DurableRecoveryOperationCommand): Promise<RecoveryEntryExecution> {
    if (!this.atomicControlOnlyEnabled) {
      return {
        route: "legacy",
        execution: await this.handlers.legacy.execute(command)
      };
    }

    if (!isAtomicControlOnly(command.operation)) {
      throw new AtomicRecoveryOperationUnsupportedError(command.operation);
    }

    const execution = await this.handlers.atomic.execute(command, true);
    if (execution.action === "legacy_unchanged" ||
        execution.action === "unsupported_atomic_operation") {
      throw new Error("Atomic handler violated Recovery entry ownership");
    }
    return { route: "atomic_control_only", execution };
  }
}
