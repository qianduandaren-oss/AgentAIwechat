import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type {
  DurableRecoveryCommandRecord,
  RecoveryCommandResultSnapshot
} from "./recovery-command-store.js";

/**
 * Day 67: opt-in candidate shared Claim contract. Implementation is
 * provided by SQLiteRecoveryFinalizationUnitOfWork. Both
 * routes MUST use the same transactional authority.
 */
export type RecoveryClaimOwner =
  NonNullable<DurableRecoveryCommandRecord["executionOwner"]>;

/**
 * "claimed_executing" means accepted v1 -> executing v2 was committed by the
 * shared claim transaction, NOT that an operation was already finalized.
 * Same-owner repeats suspend or replay; a mismatched/unknown owner must throw.
 */
export type SharedRecoveryOwnershipClaim =
  | {
      action: "claimed_executing";
      owner: RecoveryClaimOwner;
      record: DurableRecoveryCommandRecord;
    }
  | {
      action: "suspend_in_flight";
      owner: RecoveryClaimOwner;
      record: DurableRecoveryCommandRecord;
    }
  | {
      action: "replayed_terminal";
      owner: RecoveryClaimOwner;
      record: DurableRecoveryCommandRecord;
      resultSnapshot: RecoveryCommandResultSnapshot;
    };

/**
 * Transactional boundary. Implementations MUST:
 * - use the SAME durable command table/database for BOTH routes;
 * - check immutable request identity and executionOwner INSIDE BEGIN IMMEDIATE;
 * - never infer legacy ownership from an absent executionOwner;
 * - insert accepted and claim executing with CAS in that transaction;
 * - never turn an in-flight retry into a second execution;
 * - require a persisted terminal ResultSnapshot for replay.
 *
 * The current atomic adapter does its own admission: connecting this API
 * also requires a claim-aware adapter path to prevent a second admission.
 */
export interface SharedRecoveryOwnershipClaimer {
  claim(
    command: DurableRecoveryOperationCommand,
    owner: RecoveryClaimOwner
  ): Promise<SharedRecoveryOwnershipClaim>;
}

/** A different or unrecorded execution owner is not a retry opportunity. */
export class RecoverySharedOwnershipConflictError extends Error {
  constructor(
    public readonly commandId: string,
    public readonly requestedOwner: RecoveryClaimOwner,
    public readonly storedOwner: RecoveryClaimOwner | undefined
  ) {
    super(`Recovery command ${commandId} belongs to ${storedOwner ?? "unknown"}, not ${requestedOwner}`);
    this.name = "RecoverySharedOwnershipConflictError";
  }
}
