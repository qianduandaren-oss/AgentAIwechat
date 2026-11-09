/**
 * Day 80 noon — advisory deployment TOPOLOGY review, not OS enforcement.
 * Never convert a passing deployment claim into production authorization.
 */
export interface SqliteWriterIsolationPlan {
  deploymentId: string;
  trustedWriterUid: number;
  legacyWorkerUid: number;
  trustedWriterHasDbMount: boolean;
  legacyWorkerHasDbMount: boolean;
  legacyWorkerPrivileged: boolean;
  legacyCanRemountDb: boolean;
  rollbackRestoresLegacyDbMount: boolean;
}

export type SqliteWriterIsolationReview =
  | { action: "hold"; reason: string; publishAuthorized: false }
  | { action: "ready_for_isolated_os_probe"; publishAuthorized: false };

/** Pure policy for candidate LAB preparation. Inputs are unverified claims. */
export function reviewSqliteWriterIsolationPlan(
  input: SqliteWriterIsolationPlan | null
): SqliteWriterIsolationReview {
  const hold = (reason: string): SqliteWriterIsolationReview =>
    ({ action: "hold", reason, publishAuthorized: false });
  if (!input || !input.deploymentId?.trim()) return hold("deployment_not_identified");
  if (!Number.isSafeInteger(input.trustedWriterUid) ||
      !Number.isSafeInteger(input.legacyWorkerUid) ||
      input.trustedWriterUid <= 0 || input.legacyWorkerUid <= 0)
    return hold("non_dedicated_os_identity");
  if (input.trustedWriterUid === input.legacyWorkerUid)
    return hold("same_os_identity");
  if (input.trustedWriterHasDbMount !== true)
    return hold("trusted_writer_db_mount_missing");
  if (input.legacyWorkerHasDbMount !== false)
    return hold("legacy_db_mount_present");
  if (input.legacyWorkerPrivileged !== false)
    return hold("legacy_privileged");
  if (input.legacyCanRemountDb !== false)
    return hold("legacy_can_remount_db");
  if (input.rollbackRestoresLegacyDbMount !== false)
    return hold("rollback_restores_db_mount");
  // Passing claims only means the lab probe can be attempted.
  return { action: "ready_for_isolated_os_probe", publishAuthorized: false };
}


/**
 * Day 80 evening: handoff checklist review only. These are unverified operator
 * statements, not OS or container attestations. Never authorize publishing.
 */
export interface SqliteWriterHandoffSnapshot {
  deploymentId: string;
  legacyProcessesStopped: boolean;
  legacyWritableDescriptorsClosed: boolean;
  legacyDatabaseMountRemoved: boolean;
  mixedVersionDirectSqlDenied: boolean;
  rollbackCannotRestoreDbMount: boolean;
  rawAckIngressDisabled: boolean;
}

export type SqliteWriterHandoffReview =
  | { action: "hold"; reason: string; publishAuthorized: false }
  | { action: "ready_for_external_enforcement_review"; publishAuthorized: false };

export function reviewSqliteWriterHandoff(
  snapshot: SqliteWriterHandoffSnapshot | null
): SqliteWriterHandoffReview {
  if (!snapshot?.deploymentId?.trim())
    return { action: "hold", reason: "deployment_not_identified", publishAuthorized: false };
  const checks: ReadonlyArray<keyof Omit<SqliteWriterHandoffSnapshot, "deploymentId">> = [
    "legacyProcessesStopped",
    "legacyWritableDescriptorsClosed",
    "legacyDatabaseMountRemoved",
    "mixedVersionDirectSqlDenied",
    "rollbackCannotRestoreDbMount",
    "rawAckIngressDisabled"
  ];
  for (const key of checks) {
    if (snapshot[key] !== true)
      return { action: "hold", reason: "missing_or_failed:" + key, publishAuthorized: false };
  }
  return { action: "ready_for_external_enforcement_review", publishAuthorized: false };
}
