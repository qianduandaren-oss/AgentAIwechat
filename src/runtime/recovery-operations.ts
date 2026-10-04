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
  | "quarantine"
  | "release_quarantine"
  | "resume"
  | "dead_letter";

export interface RecoveryOperationCommand {
  runId: string;
  operation: RecoveryOperation;
  requestedBy: string;
  reason: string;
  expectedCheckpointVersion: number;
  expectedControlVersion?: number;
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
  | "quarantined"
  | "dead_lettered";

export interface RecoveryControlState {
  runId: string;
  version: number;
  status: RecoveryOperationalStatus;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

export class RecoveryControlConflictError
  extends Error {

  constructor(
    public readonly runId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Recovery control conflict for ${runId}: expected version ${expectedVersion}, actual version ${actualVersion}`
    );
    this.name =
      "RecoveryControlConflictError";
  }
}

export interface RecoveryControlStore {
  load(
    runId: string
  ): Promise<RecoveryControlState | undefined>;

  save(
    state: RecoveryControlState,
    expectedVersion: number
  ): Promise<RecoveryControlState>;
}

function cloneControlState(
  state: RecoveryControlState
): RecoveryControlState {
  return structuredClone(state);
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
      ? cloneControlState(state)
      : undefined;
  }

  async save(
    state: RecoveryControlState,
    expectedVersion: number
  ): Promise<RecoveryControlState> {
    const current =
      this.states.get(state.runId);

    const actualVersion =
      current?.version ?? 0;

    if (
      actualVersion !==
      expectedVersion
    ) {
      throw new RecoveryControlConflictError(
        state.runId,
        expectedVersion,
        actualVersion
      );
    }

    const saved: RecoveryControlState = {
      ...cloneControlState(state),
      version: actualVersion + 1
    };

    this.states.set(
      saved.runId,
      cloneControlState(saved)
    );

    return cloneControlState(saved);
  }
}

export type RecoveryOperationResultStatus =
  | "executed"
  | "rejected"
  | "quarantined"
  | "released"
  | "dead_lettered"
  | "no_op";

export interface RecoveryOperationResult {
  status: RecoveryOperationResultStatus;
  reason: string;
  checkpoint: AgentRunCheckpoint;
  controlState: RecoveryControlState;
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

    const control =
      await this.loadControlState(
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
        checkpoint,
        controlState: control
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
        checkpoint,
        controlState: control
      };
    }

    const expectedControlVersion =
      command.expectedControlVersion ?? 0;

    if (
      control.version !==
      expectedControlVersion
    ) {
      await this.audit(
        command,
        "denied",
        "control_version_conflict"
      );

      return {
        status: "rejected",
        reason:
          "control_version_conflict",
        checkpoint,
        controlState: control
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
        checkpoint,
        controlState: control
      };
    }

    if (
      control.status ===
      "dead_lettered"
    ) {
      await this.audit(
        command,
        "denied",
        "run_dead_lettered"
      );

      return {
        status: "rejected",
        reason: "run_dead_lettered",
        checkpoint,
        controlState: control
      };
    }

    if (
      command.operation === "quarantine"
    ) {
      if (
        control.status ===
        "quarantined"
      ) {
        await this.audit(
          command,
          "executed",
          "run_already_quarantined_noop"
        );

        return {
          status: "no_op",
          reason:
            "run_already_quarantined",
          checkpoint,
          controlState: control
        };
      }

      const nextControl =
        await this.controlStore.save(
          {
            ...control,
            status: "quarantined",
            reason: command.reason,
            updatedBy:
              command.requestedBy,
            updatedAt: this.now()
          },
          control.version
        );

      await this.audit(
        command,
        "executed",
        "run_quarantined"
      );

      return {
        status: "quarantined",
        reason: "run_quarantined",
        checkpoint,
        controlState: nextControl
      };
    }

    if (
      command.operation ===
      "release_quarantine"
    ) {
      if (
        control.status !==
        "quarantined"
      ) {
        await this.audit(
          command,
          "denied",
          "release_requires_quarantine"
        );

        return {
          status: "rejected",
          reason:
            "release_requires_quarantine",
          checkpoint,
          controlState: control
        };
      }

      const nextControl =
        await this.controlStore.save(
          {
            ...control,
            status: "active",
            reason: command.reason,
            updatedBy:
              command.requestedBy,
            updatedAt: this.now()
          },
          control.version
        );

      await this.audit(
        command,
        "executed",
        "run_released"
      );

      return {
        status: "released",
        reason: "run_released",
        checkpoint,
        controlState: nextControl
      };
    }

    if (
      command.operation ===
      "dead_letter"
    ) {
      const nextControl =
        await this.controlStore.save(
          {
            ...control,
            status:
              "dead_lettered",
            reason: command.reason,
            updatedBy:
              command.requestedBy,
            updatedAt: this.now()
          },
          control.version
        );

      await this.audit(
        command,
        "executed",
        "run_dead_lettered"
      );

      return {
        status: "dead_lettered",
        reason: "run_dead_lettered",
        checkpoint,
        controlState: nextControl
      };
    }

    if (
      command.operation === "resume"
    ) {
      if (
        control.status !==
        "quarantined"
      ) {
        await this.audit(
          command,
          "denied",
          "resume_requires_quarantine"
        );

        return {
          status: "rejected",
          reason:
            "resume_requires_quarantine",
          checkpoint,
          controlState: control
        };
      }

      const released =
        await this.controlStore.save(
          {
            ...control,
            status: "active",
            reason: command.reason,
            updatedBy:
              command.requestedBy,
            updatedAt: this.now()
          },
          control.version
        );

      return this.runRecovery(
        command,
        released
      );
    }

    if (
      control.status === "quarantined"
    ) {
      await this.audit(
        command,
        "denied",
        "run_quarantined"
      );

      return {
        status: "rejected",
        reason: "run_quarantined",
        checkpoint,
        controlState: control
      };
    }

    return this.runRecovery(
      command,
      control
    );
  }

  private async runRecovery(
    command: RecoveryOperationCommand,
    controlState: RecoveryControlState
  ): Promise<RecoveryOperationResult> {
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
        controlState,
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

  private async loadControlState(
    runId: string
  ): Promise<RecoveryControlState> {
    const state =
      await this.controlStore.load(
        runId
      );

    if (state) {
      return state;
    }

    return {
      runId,
      version: 0,
      status: "active",
      updatedAt: this.now()
    };
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
