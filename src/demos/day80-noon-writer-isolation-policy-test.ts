import { strict as assert } from "node:assert";
import {
  reviewSqliteWriterIsolationPlan,
  type SqliteWriterIsolationPlan
} from "../runtime/recovery-sqlite-writer-isolation-review.js";

const healthy: SqliteWriterIsolationPlan = {
  deploymentId: "isolated-lab-only",
  trustedWriterUid: 20010,
  legacyWorkerUid: 20020,
  trustedWriterHasDbMount: true,
  legacyWorkerHasDbMount: false,
  legacyWorkerPrivileged: false,
  legacyCanRemountDb: false,
  rollbackRestoresLegacyDbMount: false
};
const review = (patch: Partial<SqliteWriterIsolationPlan> = {}) =>
  reviewSqliteWriterIsolationPlan({ ...healthy, ...patch });
assert.deepEqual(review(), {
  action: "ready_for_isolated_os_probe",
  publishAuthorized: false
});
assert.deepEqual(reviewSqliteWriterIsolationPlan(null), {
  action: "hold", reason: "deployment_not_identified", publishAuthorized: false
});
for (const [patch, expected] of [
  [{ legacyWorkerUid: 20010 }, "same_os_identity"],
  [{ legacyWorkerUid: 0 }, "non_dedicated_os_identity"],
  [{ trustedWriterUid: 0 }, "non_dedicated_os_identity"],
  [{ trustedWriterHasDbMount: false }, "trusted_writer_db_mount_missing"],
  [{ legacyWorkerHasDbMount: true }, "legacy_db_mount_present"],
  [{ legacyWorkerPrivileged: true }, "legacy_privileged"],
  [{ legacyCanRemountDb: true }, "legacy_can_remount_db"],
  [{ rollbackRestoresLegacyDbMount: true }, "rollback_restores_db_mount"]
] as const) {
  const result = review(patch);
  assert.equal(result.action, "hold");
  if (result.action === "hold") assert.equal(result.reason, expected);
  assert.equal(result.publishAuthorized, false);
}
console.log("PASS Day 80 isolation plan review: unsafe layouts held; no publish authorization");
