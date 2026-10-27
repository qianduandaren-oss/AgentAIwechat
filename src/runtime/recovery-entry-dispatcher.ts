import {
  decideDurableRecoveryOperation,
  type DurableRecoveryOperationCommand,
  type DurableRecoveryOperationExecution
} from "./durable-recovery-operation-orchestrator.js";
import type { DurableRecoveryCommandRecord } from "./recovery-command-store.js";
import type { AtomicControlOnlyExecution } from "./recovery-atomic-control-only-adapter.js";
import type {
  SharedRecoveryOwnershipClaim,
  SharedRecoveryOwnershipClaimer
} from "./recovery-shared-ownership-claim.js";

/**
 * Composition boundary ONLY. No production Recovery HTTP route is wired here.
 * Select ownership before any admission, authorization, tool call or legacy write.
 * An atomic failure MUST NEVER invoke the legacy handler as a fallback.
 */
export interface RecoveryEntryHandlers {
  legacy: {
    execute(command: DurableRecoveryOperationCommand): Promise<DurableRecoveryOperationExecution>;
    executeClaimed?: (
      command: DurableRecoveryOperationCommand,
      claim: SharedRecoveryOwnershipClaim
    ) => Promise<DurableRecoveryOperationExecution>;
  };
  atomic: {
    execute(
      command: DurableRecoveryOperationCommand,
      atomicControlOnlyEnabled: boolean
    ): Promise<AtomicControlOnlyExecution>;
    executeClaimed?: (
      command: DurableRecoveryOperationCommand,
      claim: SharedRecoveryOwnershipClaim
    ) => Promise<AtomicControlOnlyExecution>;
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

/** A durable owner read must use the SAME command store as both routes. */
export interface RecoveryEntryOwnershipReader {
  loadCommand(
    commandId: string
  ): DurableRecoveryCommandRecord | undefined | Promise<DurableRecoveryCommandRecord | undefined>;
}

export class RecoveryEntryOwnershipConflictError extends Error {
  constructor(
    public readonly commandId: string,
    public readonly selectedOwner: "legacy" | "atomic_control_only",
    public readonly persistedOwner: "legacy" | "atomic_control_only" | undefined
  ) {
    super(`Recovery route ownership conflict for ${commandId}: selected ${selectedOwner}, persisted ${persistedOwner ?? "unknown"}`);
    this.name = "RecoveryEntryOwnershipConflictError";
  }
}

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
    private readonly atomicControlOnlyEnabled: boolean,
    /** Optional guard for migration callers. Required before any production cutover. */
    private readonly ownershipReader?: RecoveryEntryOwnershipReader,
    /** Candidate atomic claim shared by BOTH owner paths, never preflight SELECT. */
    private readonly sharedClaimer?: SharedRecoveryOwnershipClaimer
  ) {}

  async execute(command: DurableRecoveryOperationCommand): Promise<RecoveryEntryExecution> {
    if (this.sharedClaimer) {
      // Fail before admission if operation or handler is not claim-aware.
      if (this.atomicControlOnlyEnabled) {
        if (!isAtomicControlOnly(command.operation)) {
          throw new AtomicRecoveryOperationUnsupportedError(command.operation);
        }
        const handler = this.handlers.atomic.executeClaimed;
        if (!handler) throw new Error("Atomic handler is not shared-claim aware");
        const claim = await this.sharedClaimer.claim(command, "atomic_control_only");
        const execution = await handler.call(this.handlers.atomic, command, claim);
        if (execution.action === "legacy_unchanged" ||
            execution.action === "unsupported_atomic_operation") {
          throw new Error("Atomic handler violated shared-claim ownership");
        }
        return { route: "atomic_control_only", execution };
      }
      const handler = this.handlers.legacy.executeClaimed;
      if (!handler) throw new Error("Legacy handler is not shared-claim aware");
      const claim = await this.sharedClaimer.claim(command, "legacy");
      return {
        route: "legacy",
        execution: await handler.call(this.handlers.legacy, command, claim)
      };
    }

    // A fresh flag does not erase the owner recorded when a command was admitted.
    // Unknown historical ownership is fail-closed when this guard is installed.
    // This read is PRE-FLIGHT only: production still needs a shared transactional
    // ownership/admission boundary to remove cross-process TOCTOU races.
    if (this.ownershipReader) {
      const existing = await this.ownershipReader.loadCommand(command.commandId);
      if (existing) {
        decideDurableRecoveryOperation(existing, command);
        const selectedOwner = this.atomicControlOnlyEnabled
          ? "atomic_control_only" as const
          : "legacy" as const;
        if (existing.executionOwner !== selectedOwner) {
          throw new RecoveryEntryOwnershipConflictError(
            command.commandId, selectedOwner, existing.executionOwner
          );
        }
      }
    }

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
