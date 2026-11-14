import { strict as assert } from "node:assert";
import {
  reviewRecoveryWriterCreationBoundary,
  type RecoveryWriterCreationBoundaryInput
} from "../runtime/recovery-writer-creation-boundary.js";

const active = {
  deploymentId: "staging:day85",
  revision: 8,
  policySha256: "a".repeat(64)
};
const base: RecoveryWriterCreationBoundaryInput = {
  intent: "isolated_candidate",
  entrypoint: "trust_bound_factory",
  deploymentId: active.deploymentId,
  trustedBootstrapWatermark: active,
  writerWatermark: { ...active }
};
const accepted = reviewRecoveryWriterCreationBoundary(base);
assert.equal(accepted.action, "ready_for_isolated_factory_test");
assert.equal(accepted.publishAuthorized, false);
if (accepted.action !== "ready_for_isolated_factory_test") throw Error("unexpected_hold");
assert.ok(Object.isFrozen(accepted.activeWatermark));

function denied(
  changed: Partial<RecoveryWriterCreationBoundaryInput>,
  expected: string
): void {
  const result = reviewRecoveryWriterCreationBoundary({ ...base, ...changed });
  assert.equal(result.action, "hold");
  assert.equal(result.publishAuthorized, false);
  if (result.action === "hold") assert.equal(result.reason, expected);
}

denied({ intent: "production_release" }, "production_os_and_legacy_isolation_not_verified");
denied({ entrypoint: "legacy_constructor" }, "legacy_unfenced_writer_forbidden");
denied({ trustedBootstrapWatermark: null }, "trusted_bootstrap_watermark_missing");
denied({ writerWatermark: null }, "writer_active_watermark_missing");
denied({ deploymentId: "other" }, "deployment_not_bound_to_trusted_bootstrap");
denied({ writerWatermark: { ...active, revision: 7 } }, "stale_trust_revision_fenced");
denied({ writerWatermark: { ...active, policySha256: "b".repeat(64) } }, "trust_policy_digest_mismatch");
denied({ writerWatermark: { ...active, deploymentId: "other" } }, "trust_deployment_mismatch");
console.log("PASS Day 85 morning: isolated trust-bound entry reviewed; legacy/prod held; NOT an OS or production proof");
