import { strict as assert } from "node:assert";
import {
  reviewRecoveryWriterTransportTrustPlan,
  type RecoveryWriterTransportTrustPlan
} from "../runtime/recovery-writer-transport-trust-review.js";

const common = {
  deploymentId: "staging-day82",
  identityMappingConfigured: true,
  perOperationAclSourceConfigured: true,
  legacyDbMountRemoved: true,
  legacyWritableFdsDrained: true,
  consumerAckVerifierConfigured: true
} as const;

const uds: RecoveryWriterTransportTrustPlan = {
  ...common,
  mode: "uds_peercred",
  socketDirectoryPrivate: true,
  socketPathServerOwned: true,
  osPeerCredentialVerifierInstalled: true
};
const tls: RecoveryWriterTransportTrustPlan = {
  ...common,
  mode: "mtls",
  clientCertificateRequired: true,
  verifiedCertificateChainRequired: true,
  certificateIdentityMappingConfigured: true
};
const review = reviewRecoveryWriterTransportTrustPlan;
for (const candidate of [uds, tls]) {
  assert.deepEqual(review(candidate), {
    action: "ready_for_isolated_transport_probe",
    publishAuthorized: false
  });
}
for (const [candidate, reason] of [
  [null, "transport_plan_missing"],
  [{ ...uds, mode: "http_header" }, "transport_mode_unsupported"],
  [{ ...uds, extraIdentityHeader: "X-Caller" }, "transport_plan_unexpected_or_missing_field"],
  [{ ...uds, socketDirectoryPrivate: false }, "unverified_deployment_requirement:socketDirectoryPrivate"],
  [{ ...uds, osPeerCredentialVerifierInstalled: false }, "unverified_deployment_requirement:osPeerCredentialVerifierInstalled"],
  [{ ...uds, legacyDbMountRemoved: false }, "unverified_deployment_requirement:legacyDbMountRemoved"],
  [{ ...uds, legacyWritableFdsDrained: false }, "unverified_deployment_requirement:legacyWritableFdsDrained"],
  [{ ...tls, clientCertificateRequired: false }, "unverified_deployment_requirement:clientCertificateRequired"],
  [{ ...tls, verifiedCertificateChainRequired: "yes" }, "unverified_deployment_requirement:verifiedCertificateChainRequired"],
  [{ ...tls, certificateIdentityMappingConfigured: false }, "unverified_deployment_requirement:certificateIdentityMappingConfigured"]
] as const) {
  const result = review(candidate);
  assert.equal(result.action, "hold");
  if (result.action === "hold") assert.equal(result.reason, reason);
  assert.equal(result.publishAuthorized, false);
}
console.log("PASS Day 82 transport-plan candidate review: no fabricated authenticated peer, no publish");
