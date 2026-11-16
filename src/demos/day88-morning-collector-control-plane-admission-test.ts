import { strict as assert } from "node:assert";
import {
  reviewCollectorControlPlaneCommand,
  type CollectorControlAdmissionInput,
  type CollectorControlOperation
} from "../runtime/recovery-writer-collector-control-plane-admission.js";

const time = Date.UTC(2026, 10, 17, 0, 0, 0);
const command = {
  operation: "issue_challenge" as CollectorControlOperation,
  deploymentId: "staging:day88",
  releaseId: "release-day88",
  keyId: "collector-A",
  claimedPrincipalId: "issuer-one"
};
const base: CollectorControlAdmissionInput = {
  intent: "isolated_review",
  expectedDeploymentId: "staging:day88",
  expectedReleaseId: "release-day88",
  nowEpochMs: time,
  authenticatedPeer: {
    principalId: "issuer-one",
    role: "challenge_issuer",
    deploymentId: "staging:day88",
    releaseId: "release-day88",
    allowedOperations: ["issue_challenge"]
  },
  command
};
const review = (overrides: Partial<CollectorControlAdmissionInput> = {}) =>
  reviewCollectorControlPlaneCommand({ ...base, ...overrides });
const denied = (r: ReturnType<typeof review>, reason: string) => {
  assert.equal(r.action, "hold");
  assert.equal(r.reason, reason);
  assert.equal(r.audit.decision, "deny");
  assert.equal(r.publishAuthorized, false);
};
const ok = review();
assert.equal(ok.action, "ready_for_isolated_control_plane_test");
assert.equal(ok.audit.principalId, "issuer-one");
assert.equal(ok.audit.operation, "issue_challenge");
assert.equal(ok.audit.decision, "candidate");
assert.equal(ok.publishAuthorized, false);

denied(review({ authenticatedPeer: null }), "authenticated_peer_missing");
denied(review({ intent: "production_release" }), "production_control_not_authorized");
denied(review({ expectedReleaseId: "other-release" }), "release_scope_mismatch");
denied(review({ command: { ...command, releaseId: "other" } }), "release_scope_mismatch");
denied(review({ command: { ...command, claimedPrincipalId: "administrator" } }),
  "principal_claim_mismatch");
denied(review({ authenticatedPeer: { ...base.authenticatedPeer!, role: "runtime_worker" } }),
  "role_forbidden");
denied(review({ authenticatedPeer: { ...base.authenticatedPeer!, role: "collector" } }),
  "role_forbidden");
denied(review({ authenticatedPeer: {
  ...base.authenticatedPeer!, allowedOperations: []
} }), "operation_not_granted");
denied(review({ authenticatedPeer: {
  ...base.authenticatedPeer!, role: "release_admin",
  allowedOperations: ["issue_challenge"]
} }), "role_forbidden");
denied(review({ command: { ...command, keyId: "" } }), "command_invalid");
denied(review({ nowEpochMs: -1 }), "trusted_release_context_invalid");

const admin = {
  ...base.authenticatedPeer!,
  principalId: "release-admin",
  role: "release_admin" as const,
  allowedOperations: ["provision_collector_key", "revoke_collector_key"] as const
};
for (const operation of ["provision_collector_key", "revoke_collector_key"] as const) {
  const result = review({
    authenticatedPeer: admin,
    command: { ...command, operation, claimedPrincipalId: admin.principalId }
  });
  assert.equal(result.action, "ready_for_isolated_control_plane_test");
  assert.equal(result.publishAuthorized, false);
}
console.log("PASS Day 88 morning: role/scope/actor command admission and audit intent.");
console.log("LIMIT: input authenticatedPeer must be built by trusted mTLS ingress; " +
  "no production auth, durable audit, or challenge-store enforcement. NO_GO.");
