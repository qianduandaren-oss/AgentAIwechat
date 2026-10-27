import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type {
  DurableRecoveryCommandRecord,
  RecoveryCommandResultSnapshot
} from "./recovery-command-store.js";

/**
 * Day 67 morning: API contract ONLY. No runtime claim implementation is
 * provided by this file. It MUST NOT be wired into production until BOTH
 * legacy and atomic admissions share one SQLite transactional authority.
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
 * Future transactional boundary. Implementations MUST:
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
