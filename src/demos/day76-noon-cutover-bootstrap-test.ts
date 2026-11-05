import { bootstrapRecoveryDelivery } from "../runtime/recovery-dispatcher-cutover-bootstrap.js";
import type { TrustedDispatcherCutoverEvidence } from "../runtime/recovery-dispatcher-cutover-policy.js";
import type { RecoveryVerifiedDeliveryGateway } from "../runtime/recovery-verified-delivery-gateway.js";

const valid: TrustedDispatcherCutoverEvidence = {
  legacyDispatcherDisabled: true,
  rawAcknowledgeRestricted: true,
  verifiedAdapterConfigured: true,
  durableConsumerDedupeVerified: true,
  exclusiveSqliteWriter: true,
  noMixedVersionWorkers: true
};
const gateway = {} as RecoveryVerifiedDeliveryGateway;
const accepted = await bootstrapRecoveryDelivery({ collect: async () => ({...valid}) }, gateway);
if (accepted.action !== "ready_for_candidate_tests" || accepted.gateway !== gateway) throw new Error("valid cutover denied");
for (const key of Object.keys(valid) as (keyof TrustedDispatcherCutoverEvidence)[]) {
  const denied = await bootstrapRecoveryDelivery({collect: async () => ({...valid, [key]: false})}, gateway);
  if (denied.action !== "hold" || denied.reason !== key || "gateway" in denied) throw new Error("fail-open: " + key);
}
const missing = await bootstrapRecoveryDelivery({collect: async () => {throw Error("offline");}}, gateway);
if (missing.action !== "hold" || missing.reason !== "cutover_evidence_unavailable") throw Error("evidence failure must deny");
console.log("Day 76 noon: 8 bootstrap checks passed");
