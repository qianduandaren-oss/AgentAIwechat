import type { DurableRecoveryOperationCommand } from "../runtime/durable-recovery-operation-orchestrator.js";
import type { RecoveryAuthorizationEvidence } from "../runtime/recovery-authorization-evidence.js";
import type {
  RecoveryExternalEffectIntent,
  RecoveryExternalEffectFence
} from "../runtime/recovery-external-effect-fence.js";
import type { RecoveryRemoteReceiptTerminalReview } from "../runtime/recovery-external-effect-ledger.js";
import {
  planRemoteReceiptConsumption,
  type RecoveryRemoteReceiptConsumptionInput,
  type RecoveryRemoteReceiptConsumptionPlan
} from "../runtime/recovery-remote-receipt-consumption.js";

let passed = 0;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Day 73 morning: " + message);
  passed++;
}
const command: DurableRecoveryOperationCommand = {
  commandId: "command-day73", runId: "run-day73",
  operation: "quarantine", requestedBy: "operator-a",
  reason: "verified external effect", expectedCheckpointVersion: 1,
  expectedControlVersion: 0
};
const authorizationEvidence: RecoveryAuthorizationEvidence = {
  actorId: "operator-a", tenantId: "tenant-a",
  runId: command.runId, operation: command.operation, allowed: true,
  revisions: { runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9 }
};
const intent: RecoveryExternalEffectIntent = {
  command, owner: "atomic_control_only",
  effectId: "notify:command-day73",
  idempotencyKey: "command-day73:notify",
  authorizationEvidence
};
const fence: RecoveryExternalEffectFence = {
  commandId: command.commandId, runId: command.runId,
  actorId: command.requestedBy, tenantId: "tenant-a",
  owner: intent.owner, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, epoch: 1,
  authorizationRevisions: { ...authorizationEvidence.revisions }
};
const review: RecoveryRemoteReceiptTerminalReview = {
  action: "requires_atomic_terminal_transaction",
  receiptId: "receipt-day73", commandId: command.commandId,
  runId: command.runId, expectedCommandVersion: 2,
  expectedControlVersion: 0
};
const base: RecoveryRemoteReceiptConsumptionInput = {
  intent, fence, providerId: "provider-a", review
};
function result(override: Partial<RecoveryRemoteReceiptConsumptionInput> = {}) {
  return planRemoteReceiptConsumption({ ...base, ...override });
}
function expectHold(
  value: RecoveryRemoteReceiptConsumptionPlan,
  reason: Extract<RecoveryRemoteReceiptConsumptionPlan,
    { action: "hold" }>["reason"]
) {
  check(value.action === "hold" && value.reason === reason,
    "expected hold " + reason + ", got " + JSON.stringify(value));
}

const good = result();
check(good.action === "requires_atomic_receipt_consumption", "valid proposal");
if (good.action === "requires_atomic_receipt_consumption") {
  check(good.expectedCommandVersion === 2 && good.expectedControlVersion === 0,
    "explicit CAS expectations");
  check(good.expectedEffectStatus === "unknown" &&
    good.expectedCommandStatus === "executing", "expected statuses");
  check(good.effectId === intent.effectId && good.epoch === fence.epoch,
    "effect and epoch binding");
  check(good.automaticUnknownResend === false, "never auto resend");
}
expectHold(result({ review: { action: "hold", reason: "control_cas_conflict" } }),
  "review_not_ready");
expectHold(result({ fence: { ...fence, epoch: 0 } }), "invalid_fence");
expectHold(result({ fence: { ...fence, effectId: "other-effect" } }), "invalid_fence");
expectHold(result({ fence: {
  ...fence, authorizationRevisions: { ...fence.authorizationRevisions, runAclRevision: 6 }
} }), "invalid_fence");
expectHold(result({ intent: { ...intent, owner: "legacy" },
  fence: { ...fence, owner: "legacy" } }), "unsupported_owner");
expectHold(result({ providerId: " " }), "invalid_receipt_identity");
expectHold(result({ review: { ...review, receiptId: "" } }),
  "invalid_receipt_identity");
expectHold(result({ review: { ...review, commandId: "other-command" } }),
  "identity_mismatch");
expectHold(result({ review: { ...review, runId: "other-run" } }),
  "identity_mismatch");
expectHold(result({ review: { ...review, expectedControlVersion: 1 } }),
  "version_mismatch");
expectHold(result({ review: { ...review, expectedCommandVersion: 3 as 2 } }),
  "version_mismatch");
expectHold(result({ intent: { ...intent, command: {
  ...command, expectedControlVersion: -1
} } }), "version_mismatch");
// No I/O or terminal mutation: the source inputs remain untouched.
check(review.action === "requires_atomic_terminal_transaction" &&
  fence.epoch === 1 && command.expectedControlVersion === 0,
  "planning does not mutate input");
console.log("Day 73 morning receipt consumption contract: " + passed + " checks passed");
