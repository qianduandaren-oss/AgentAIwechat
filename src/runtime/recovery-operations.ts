import {
  createAuditEvent,
  type AuditSink
} from "../security/audit-log.js";
import type {
  AgentRunCheckpoint
} from "./checkpoint.js";
import type {
  CheckpointStore
} from "./checkpoint-store.js";
import {
  CheckpointRecoveryCoordinator,
  type RecoveryCoordinatorResult
} from "./checkpoint-recovery-coordinator.js";

export type RecoveryOperation =
  | "retry_recovery"
  | "reconcile_again"
  | "quarantine";

export interface RecoveryOperationCommand {
  runId: string;
  operation: RecoveryOperation;
  requestedBy: string;
  reason: string;
  expectedCheckpointVersion: number;
}

export interface RecoveryAuthorizationDecision {
  allowed: boolean;
  reason: string;
}

export interface RecoveryOperationAuthorizer {
  authorize(
    actorId: string,
    operation: RecoveryOperation
  ):
    | RecoveryAuthorizationDecision
    | Promise<RecoveryAuthorizationDecision>;
}

export class StaticRecoveryOperationAuthorizer
  implements RecoveryOperationAuthorizer {

  constructor(
    private readonly permissions:
      Record<string, RecoveryOperation[]>
  ) {}

  authorize(
    actorId: string,
    operation: RecoveryOperation
  ): RecoveryAuthorizationDecision {
    const allowed =
      this.permissions[actorId]?.includes(
        operation
      ) ?? false;

    return {
      allowed,
      reason: allowed
        ? "allowed"
        : "recovery_operation_denied"
    };
  }
}

export type RecoveryOperationalStatus =
  | "active"
  | "quarantined";

export interface RecoveryControlState {
  runId: string;
  status: RecoveryOperationalStatus;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface RecoveryControlStore {
  load(
    runId: string
  ): Promise<RecoveryControlState | undefined>;

  save(
    state: RecoveryControlState
  ): Promise<void>;
}

export class InMemoryRecoveryControlStore
  implements RecoveryControlStore {

  private readonly states =
    new Map<string, RecoveryControlState>();

  async load(
    runId: string
  ): Promise<RecoveryControlState | undefined> {
    const state = this.states.get(runId);
    return state
      ? structuredClone(state)
      : undefined;
  }

  async save(
    state: RecoveryControlState
  ): Promise<void> {
    this.states.set(
      state.runId,
      structuredClone(state)
    );
  }
}

export type RecoveryOperationResultStatus =
  | "executed"
  | "rejected"
  | "quarantined"
  | "no_op";

export interface RecoveryOperationResult {
  status: RecoveryOperationResultStatus;
  reason: string;
  checkpoint: AgentRunCheckpoint;
  recovery?: RecoveryCoordinatorResult;
}

export interface RecoveryOperationServiceOptions {
  now?: () => string;
  auditAgentId?: string;
}

export class RecoveryOperationService {
  private readonly now: () => string;
  private readonly auditAgentId: string;

  constructor(
    private readonly checkpointStore:
      CheckpointStore,
    private readonly coordinator:
      CheckpointRecoveryCoordinator,
    private readonly authorizer:
      RecoveryOperationAuthorizer,
    private readonly controlStore:
      RecoveryControlStore,
    private readonly auditSink:
      AuditSink,
    options:
      RecoveryOperationServiceOptions = {}
  ) {
    this.now =
      options.now ??
      (() => new Date().toISOString());

    this.auditAgentId =
      options.auditAgentId ??
      "recovery_runtime";
  }

  async execute(
    command: RecoveryOperationCommand
  ): Promise<RecoveryOperationResult> {
    const decision =
      await this.authorizer.authorize(
        command.requestedBy,
        command.operation
      );

    const checkpoint =
      await this.requireCheckpoint(
        command.runId
      );

    if (!decision.allowed) {
      await this.audit(
        command,
        "denied",
        decision.reason
      );

      return {
        status: "rejected",
        reason: decision.reason,
        checkpoint
      };
    }

    if (
      checkpoint.version !==
      command.expectedCheckpointVersion
    ) {
      await this.audit(
        command,
        "denied",
        "checkpoint_version_conflict"
      );

      return {
        status: "rejected",
        reason:
          "checkpoint_version_conflict",
        checkpoint
      };
    }

    if (
      checkpoint.boundary ===
      "completed"
    ) {
      await this.audit(
        command,
        "executed",
        "checkpoint_already_completed_noop"
      );

      return {
        status: "no_op",
        reason:
          "checkpoint_already_completed",
        checkpoint
      };
    }

    const control =
      await this.controlStore.load(
        command.runId
      );

    if (
      control?.status === "quarantined" &&
      command.operation !== "quarantine"
    ) {
      await this.audit(
        command,
        "denied",
        "run_quarantined"
      );

      return {
        status: "rejected",
        reason: "run_quarantined",
        checkpoint
      };
    }

    if (
      command.operation === "quarantine"
    ) {
      await this.controlStore.save({
        runId: command.runId,
        status: "quarantined",
        reason: command.reason,
        updatedBy:
          command.requestedBy,
        updatedAt: this.now()
      });

      await this.audit(
        command,
        "executed",
        "run_quarantined"
      );

      return {
        status: "quarantined",
        reason: "run_quarantined",
        checkpoint
      };
    }

    try {
      const recovery =
        await this.coordinator.recover(
          command.runId
        );

      await this.audit(
        command,
        "executed",
        `recovery_${recovery.status}`
      );

      return {
        status: "executed",
        reason:
          `recovery_${recovery.status}`,
        checkpoint:
          recovery.checkpoint,
        recovery
      };
    } catch (error) {
      await this.audit(
        command,
        "failed",
        error instanceof Error
          ? error.message
          : "recovery_operation_failed"
      );
      throw error;
    }
  }

  private async requireCheckpoint(
    runId: string
  ): Promise<AgentRunCheckpoint> {
    const checkpoint =
      await this.checkpointStore.load(
        runId
      );

    if (!checkpoint) {
      throw new Error(
        `Checkpoint not found: ${runId}`
      );
    }

    return checkpoint;
  }

  private async audit(
    command: RecoveryOperationCommand,
    outcome:
      | "denied"
      | "executed"
      | "failed",
    reason: string
  ): Promise<void> {
    await this.auditSink.write(
      createAuditEvent({
        actorId: command.requestedBy,
        agentId: this.auditAgentId,
        action:
          `recovery.${command.operation}`,
        resourceId: command.runId,
        resourceType: "agent_run",
        outcome,
        reason,
        policy:
          "recovery.operation_service"
      })
    );
  }
}
