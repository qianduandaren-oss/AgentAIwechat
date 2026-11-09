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
