import type { ResumeBoundary } from "./checkpoint.js";
import type { RecoveryAction } from "./recovery-planner.js";
import type { ReconciliationOutcome } from "./reconciler.js";

export type RecoveryEventType =
  | "recovery_started"
  | "checkpoint_loaded"
  | "plan_decided"
  | "reconciliation_started"
  | "reconciliation_completed"
  | "checkpoint_conflict"
  | "checkpoint_saved"
  | "recovery_completed"
  | "recovery_suspended";

export interface RecoveryEvent {
  type: RecoveryEventType;
  runId: string;
  recoveryAttemptId: string;
  timestamp: string;
  checkpointVersion?: number;
  toolCallId?: string;
  toolName?: string;
  action?: RecoveryAction;
  reason?: string;
  reconciliationOutcome?: ReconciliationOutcome;
  boundary?: ResumeBoundary;
  conflictCount?: number;
}

export interface RecoveryEventSink {
  record(event: RecoveryEvent): Promise<void> | void;
}

export class InMemoryRecoveryEventSink implements RecoveryEventSink {
  private readonly events: RecoveryEvent[] = [];

  record(event: RecoveryEvent): void {
    this.events.push(structuredClone(event));
  }

  list(): RecoveryEvent[] {
    return this.events.map(event => structuredClone(event));
  }

  listByRun(runId: string): RecoveryEvent[] {
    return this.list().filter(event => event.runId === runId);
  }

  listByAttempt(recoveryAttemptId: string): RecoveryEvent[] {
    return this.list().filter(
      event => event.recoveryAttemptId === recoveryAttemptId
    );
  }
}
