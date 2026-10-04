import type {
  RecoveryEvent,
  RecoveryEventSink
} from "./recovery-observability.js";

export interface SuspendedRunRecord {
  runId: string;
  recoveryAttemptId: string;
  checkpointVersion?: number;
  toolCallId?: string;
  toolName?: string;
  reason?: string;
  conflictCount?: number;
  suspendedAt: string;
}

export class InMemorySuspendedRunRegistry
  implements RecoveryEventSink {

  private readonly records =
    new Map<string, SuspendedRunRecord>();

  record(event: RecoveryEvent): void {
    if (event.type === "recovery_suspended") {
      this.records.set(event.runId, {
        runId: event.runId,
        recoveryAttemptId:
          event.recoveryAttemptId,
        checkpointVersion:
          event.checkpointVersion,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        reason: event.reason,
        conflictCount: event.conflictCount,
        suspendedAt: event.timestamp
      });
      return;
    }

    if (event.type === "recovery_completed") {
      this.records.delete(event.runId);
    }
  }

  get(
    runId: string
  ): SuspendedRunRecord | undefined {
    const record = this.records.get(runId);
    return record
      ? structuredClone(record)
      : undefined;
  }

  list(): SuspendedRunRecord[] {
    return [...this.records.values()]
      .map(record => structuredClone(record))
      .sort((a, b) =>
        a.suspendedAt.localeCompare(
          b.suspendedAt
        )
      );
  }
}
