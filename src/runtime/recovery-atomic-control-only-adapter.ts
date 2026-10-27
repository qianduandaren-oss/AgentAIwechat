import {
  decideDurableRecoveryOperation,
  type DurableRecoveryOperationCommand
} from "./durable-recovery-operation-orchestrator.js";
import {
  RecoverySharedOwnershipConflictError,
  type SharedRecoveryOwnershipClaim
} from "./recovery-shared-ownership-claim.js";
import type {
  DurableRecoveryCommandRecord,
  RecoveryCommandResultSnapshot
} from "./recovery-command-store.js";
import type { RecoveryOperationAuthorizer } from "./recovery-operations.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import {
  selectAtomicRecoveryRoute
} from "./recovery-atomic-route-decision.js";
import { prepareControlOnlyRecovery } from "./recovery-control-preparation.js";
import { SQLiteRecoveryFinalizationUnitOfWork } from "./sqlite-recovery-finalization.js";

/**
 * Opt-in, side-effect-contained adapter for the THREE control-only operations.
 * Never calls RecoveryOperationService or the old Orchestrator as a fallback.
 * Production routing must be separately reviewed and enabled.
 */
export type AtomicControlOnlyExecution =
  | { action: "legacy_unchanged" }
  | { action: "unsupported_atomic_operation" }
  | { action: "suspend_in_flight"; record: DurableRecoveryCommandRecord }
  | {
      action: "replayed_terminal" | "executed_new";
      record: DurableRecoveryCommandRecord;
      resultSnapshot: RecoveryCommandResultSnapshot;
    };

export class AtomicRecoveryControlOnlyAdapter {
  constructor(
    private readonly finalizer: SQLiteRecoveryFinalizationUnitOfWork,
    private readonly authorizer: RecoveryOperationAuthorizer,
    private readonly now: () => string = () => new Date().toISOString(),
    /** Test-only injection, called AFTER commit to emulate a lost reply. */
    private readonly afterCommit?: () => void
  ) {}


  /**
   * Candidate shared-Claim route: executing v2 already belongs to this owner.
   * Skips BOTH the preflight admission and admitControlOnlyCommand.
   */
  async executeClaimed(
    command: DurableRecoveryOperationCommand,
    claim: SharedRecoveryOwnershipClaim
  ): Promise<AtomicControlOnlyExecution> {
    if (claim.owner !== "atomic_control_only" ||
        claim.record.executionOwner !== "atomic_control_only") {
      throw new RecoverySharedOwnershipConflictError(
        command.commandId, "atomic_control_only", claim.record.executionOwner
      );
    }
    decideDurableRecoveryOperation(claim.record, command);
    if (claim.action === "replayed_terminal") {
      return {
        action: "replayed_terminal", record: claim.record,
        resultSnapshot: structuredClone(claim.resultSnapshot)
      };
    }
    if (claim.action === "suspend_in_flight") {
      return { action: "suspend_in_flight", record: claim.record };
    }
    if (claim.record.status !== "executing" || claim.record.version !== 2) {
      throw new Error("Shared atomic claim is not executing v2");
    }
    return this.executeAlreadyAdmitted(command, claim.record);
  }

  async execute(
    command: DurableRecoveryOperationCommand,
    atomicControlOnlyEnabled: boolean
  ): Promise<AtomicControlOnlyExecution> {
    // Do not fall back to the old executor after a failed atomic attempt.
    const initial = selectAtomicRecoveryRoute({
      atomicControlOnlyEnabled,
      command,
      existing: atomicControlOnlyEnabled
        ? this.finalizer.loadCommand(command.commandId)
        : undefined
    });
    if (initial.action === "legacy_unchanged" ||
        initial.action === "unsupported_atomic_operation") {
      return initial;
    }
    if (initial.action === "replay_terminal") {
      return {
        action: "replayed_terminal",
        record: initial.record,
        resultSnapshot: structuredClone(initial.resultSnapshot)
      };
    }
    if (initial.action === "suspend_in_flight") {
      return initial;
    }

    // Recheck identity/status WITHIN BEGIN IMMEDIATE: two concurrent
    // first requests must not both claim the command.
    const admission = this.finalizer.admitControlOnlyCommand(command);
    if (admission.action === "replay_terminal") {
      return {
        action: "replayed_terminal",
        record: admission.record,
        resultSnapshot: structuredClone(admission.resultSnapshot)
      };
    }
    if (admission.action === "suspend_in_flight") {
      return admission;
    }
    if (admission.action !== "admitted_executing") {
      throw new Error("Unexpected atomic admission decision");
    }

    return this.executeAlreadyAdmitted(command, admission.record);
  }

  private async executeAlreadyAdmitted(
    command: DurableRecoveryOperationCommand,
    executing: DurableRecoveryCommandRecord
  ): Promise<AtomicControlOnlyExecution> {
    const checkpoint = this.finalizer.loadCheckpoint(command.runId);
    if (!checkpoint) {
      // Durable in-flight fact remains for explicit reconciliation.
      throw new Error(`Checkpoint not found: ${command.runId}`);
    }
    const control = this.finalizer.loadControl(command.runId);
    const authorization = await this.authorizer.authorize(
      command.requestedBy, command.operation
    );
    const prepared = prepareControlOnlyRecovery({
      command,
      checkpoint,
      control,
      authorization,
      timestamp: this.now()
    });

    const controlVersion =
      prepared.expectedControlVersion +
      (prepared.writeSet.control === "cas_update" ? 1 : 0);
    const snapshot: RecoveryCommandResultSnapshot = {
      status: prepared.status,
      reason: prepared.reason,
      checkpointVersion: prepared.expectedCheckpointVersion,
      controlVersion
    };
    const timestamp = this.now();
    const terminal: DurableRecoveryCommandRecord = {
      ...executing,
      status: prepared.outcome === "rejected" ? "rejected" : "succeeded",
      resultReason: prepared.reason,
      resultSnapshot: snapshot,
      updatedAt: timestamp
    };
    const event: RecoveryOutboxRecord = {
      id: `${command.commandId}:terminal`,
      eventId: `recovery:${command.commandId}:terminal`,
      commandId: command.commandId,
      runId: command.runId,
      kind: "audit",
      payload: JSON.stringify({
        operation: command.operation,
        outcome: prepared.outcome,
        reason: prepared.reason
      }),
      status: "pending",
      attempts: 0,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.finalizer.commit({
      checkpoint: prepared.checkpoint,
      expectedCheckpointVersion: prepared.expectedCheckpointVersion,
      control: prepared.control,
      expectedControlVersion: prepared.expectedControlVersion,
      command: terminal,
      expectedCommandVersion: executing.version,
      outbox: [event],
      writeSet: prepared.writeSet
    });

    // Read durable truth rather than returning a tentative draft.
    this.afterCommit?.();
    const persisted = this.finalizer.loadCommand(command.commandId);
    if (!persisted?.resultSnapshot ||
        !["succeeded", "rejected", "failed"].includes(persisted.status)) {
      throw new Error("Committed command is missing terminal snapshot");
    }
    return {
      action: "executed_new",
      record: persisted,
      resultSnapshot: structuredClone(persisted.resultSnapshot)
    };
  }
}
