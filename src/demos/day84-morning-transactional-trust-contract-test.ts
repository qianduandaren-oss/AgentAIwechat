import { strict as assert } from "node:assert";
import {
  assertRecoveryWriterTrustMatch,
  RecoveryWriterTrustFenceConflict,
  RECOVERY_WRITER_TRUST_FENCE_RELEASE
} from "../runtime/recovery-writer-transactional-trust-contract.js";

const active = { deploymentId: "stage:84", revision: 7, policySha256: "a".repeat(64) };
function denied(observed: typeof active | null, reason: string) {
  assert.throws(
    () => assertRecoveryWriterTrustMatch(active, observed),
    (error: unknown) => error instanceof RecoveryWriterTrustFenceConflict && error.reason === reason
  );
}

assert.doesNotThrow(() => assertRecoveryWriterTrustMatch(active, { ...active, policySha256: "A".repeat(64) }));
denied(null, "transactional_watermark_unavailable");
denied({ ...active, revision: 6 }, "stale_trust_revision_fenced");
denied({ ...active, revision: 8 }, "stale_trust_revision_fenced");
denied({ ...active, policySha256: "b".repeat(64) }, "trust_policy_digest_mismatch");
denied({ ...active, deploymentId: "other" }, "trust_deployment_mismatch");
assert.throws(
  () => assertRecoveryWriterTrustMatch(null, active),
  (error: unknown) => error instanceof RecoveryWriterTrustFenceConflict &&
    error.reason === "trusted_active_watermark_invalid"
);
assert.equal(RECOVERY_WRITER_TRUST_FENCE_RELEASE.publishAuthorized, false);
console.log("PASS Day 84 morning: pure trust watermark comparison; not a SQLite transaction or production release");
