import { strict as assert } from "node:assert";
import {
  reviewSqliteWriterHandoff,
  type SqliteWriterHandoffSnapshot
} from "../runtime/recovery-sqlite-writer-isolation-review.js";

const nominal: SqliteWriterHandoffSnapshot = {
  deploymentId: "disposable-lab-deployment",
  legacyProcessesStopped: true,
  legacyWritableDescriptorsClosed: true,
  legacyDatabaseMountRemoved: true,
  mixedVersionDirectSqlDenied: true,
  rollbackCannotRestoreDbMount: true,
  rawAckIngressDisabled: true
};

assert.deepEqual(reviewSqliteWriterHandoff(nominal), {
  action: "ready_for_external_enforcement_review",
  publishAuthorized: false
});
assert.deepEqual(reviewSqliteWriterHandoff(null), {
  action: "hold",
  reason: "deployment_not_identified",
  publishAuthorized: false
});
for (const key of [
  "legacyProcessesStopped",
  "legacyWritableDescriptorsClosed",
  "legacyDatabaseMountRemoved",
  "mixedVersionDirectSqlDenied",
  "rollbackCannotRestoreDbMount",
  "rawAckIngressDisabled"
] as const) {
  const result = reviewSqliteWriterHandoff({ ...nominal, [key]: false });
  assert.deepEqual(result, {
    action: "hold",
    reason: "missing_or_failed:" + key,
    publishAuthorized: false
  });
}
// A stale or incomplete snapshot must not turn into an authorization.
const incomplete = { ...nominal, rollbackCannotRestoreDbMount: undefined };
assert.equal(
  reviewSqliteWriterHandoff(incomplete as unknown as SqliteWriterHandoffSnapshot).action,
  "hold"
);
console.log("PASS Day 80 evening handoff review: mixed-version, old-fd, rollback all fail closed; never GO");
