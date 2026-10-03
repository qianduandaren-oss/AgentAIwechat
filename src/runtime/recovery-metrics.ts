import type {
  RecoveryEvent,
  RecoveryEventSink
} from "./recovery-observability.js";

export interface RecoveryMetricsSnapshot {
  attempts: number;
  completed: number;
  suspended: number;
  checkpointConflicts: number;
  durationCount: number;
  durationTotalMs: number;
  durationMaxMs: number;
  durationAverageMs: number;
}

export class InMemoryRecoveryMetrics
  implements RecoveryEventSink {

  private attempts = 0;
  private completed = 0;
  private suspended = 0;
  private checkpointConflicts = 0;

  private durationCount = 0;
  private durationTotalMs = 0;
  private durationMaxMs = 0;

  private readonly startedAt =
    new Map<string, number>();

  private readonly terminalAttempts =
    new Set<string>();

  record(event: RecoveryEvent): void {
    if (event.type === "recovery_started") {
      this.attempts += 1;
      this.startedAt.set(
        event.recoveryAttemptId,
        Date.parse(event.timestamp)
      );
      return;
    }

    if (event.type === "checkpoint_conflict") {
      this.checkpointConflicts += 1;
      return;
    }

    if (
      event.type !== "recovery_completed" &&
      event.type !== "recovery_suspended"
    ) {
      return;
    }

    if (
      this.terminalAttempts.has(
        event.recoveryAttemptId
      )
    ) {
      return;
    }

    this.terminalAttempts.add(
      event.recoveryAttemptId
    );

    if (event.type === "recovery_completed") {
      this.completed += 1;
    } else {
      this.suspended += 1;
    }

    const start =
      this.startedAt.get(
        event.recoveryAttemptId
      );
    const end =
      Date.parse(event.timestamp);

    if (
      start !== undefined &&
      Number.isFinite(end)
    ) {
      const duration = Math.max(
        0,
        end - start
      );

      this.durationCount += 1;
      this.durationTotalMs += duration;
      this.durationMaxMs = Math.max(
        this.durationMaxMs,
        duration
      );
    }
  }

  snapshot(): RecoveryMetricsSnapshot {
    return {
      attempts: this.attempts,
      completed: this.completed,
      suspended: this.suspended,
      checkpointConflicts:
        this.checkpointConflicts,
      durationCount: this.durationCount,
      durationTotalMs:
        this.durationTotalMs,
      durationMaxMs: this.durationMaxMs,
      durationAverageMs:
        this.durationCount === 0
          ? 0
          : this.durationTotalMs /
            this.durationCount
    };
  }
}
