import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import {
  RecoveryEntryDispatcher,
  type RecoveryEntryExecution,
  type RecoveryEntryHandlers
} from "./recovery-entry-dispatcher.js";
import type { SharedRecoveryOwnershipClaimer } from "./recovery-shared-ownership-claim.js";

/**
 * Day 67 evening: candidate composition gate. Prevents accidentally constructing
 * an ingress that silently falls back to preflight-only or independently admits.
 * This is NOT wired to production HTTP/CLI and cannot prove both dependencies
 * actually use the same database. The composition root must ensure that.
 */
export class RecoveryClaimRequiredError extends Error {
  constructor(reason: string) {
    super(`Claim-required recovery ingress: ${reason}`);
    this.name = "RecoveryClaimRequiredError";
  }
}

export class ClaimRequiredRecoveryEntry {
  private readonly dispatcher: RecoveryEntryDispatcher;

  constructor(
    handlers: RecoveryEntryHandlers,
    atomicControlOnlyEnabled: boolean,
    sharedClaimer: SharedRecoveryOwnershipClaimer | undefined
  ) {
    if (!sharedClaimer || typeof sharedClaimer.claim !== "function") {
      throw new RecoveryClaimRequiredError("missing shared transactional claimer");
    }
    if (typeof handlers.legacy.executeClaimed !== "function") {
      throw new RecoveryClaimRequiredError("legacy handler is not claim-aware");
    }
    if (typeof handlers.atomic.executeClaimed !== "function") {
      throw new RecoveryClaimRequiredError("atomic handler is not claim-aware");
    }
    this.dispatcher = new RecoveryEntryDispatcher(
      handlers, atomicControlOnlyEnabled, undefined, sharedClaimer
    );
  }

  execute(command: DurableRecoveryOperationCommand): Promise<RecoveryEntryExecution> {
    return this.dispatcher.execute(command);
  }
}
