import {
  assertRecoveryExternalEffectFenceBinding,
  RecoveryExternalEffectFenceConflictError,
  type RecoveryExternalEffectFence,
  type RecoveryExternalEffectIntent
} from "../runtime/recovery-external-effect-fence.js";

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

const intent: RecoveryExternalEffectIntent = {
  command: {
    commandId: "command-70",
    runId: "run-70",
    operation: "quarantine",
    requestedBy: "operator-a",
    reason: "manual incident review",
    expectedCheckpointVersion: 1,
    expectedControlVersion: 0
  },
  owner: "atomic_control_only",
  effectId: "notify:run-70:quarantine",
  idempotencyKey: "command-70:notify",
  authorizationEvidence: {
    actorId: "operator-a",
    tenantId: "tenant-a",
    runId: "run-70",
    operation: "quarantine",
    allowed: true,
    revisions: {
      runTenantRevision: 2,
      runAclRevision: 3,
      actorGrantRevision: 9
    }
  }
};

const fence: RecoveryExternalEffectFence = {
  commandId: "command-70",
  runId: "run-70",
  actorId: "operator-a",
  tenantId: "tenant-a",
  owner: "atomic_control_only",
  effectId: "notify:run-70:quarantine",
  idempotencyKey: "command-70:notify",
  epoch: 4,
  authorizationRevisions: {
    runTenantRevision: 2,
    runAclRevision: 3,
    actorGrantRevision: 9
  }
};

function mustReject(
  label: string,
  badIntent: RecoveryExternalEffectIntent,
  badFence: RecoveryExternalEffectFence | undefined
): void {
  let rejected = false;
  try {
    assertRecoveryExternalEffectFenceBinding(badIntent, badFence);
  } catch (error) {
    rejected = error instanceof RecoveryExternalEffectFenceConflictError;
  }
  assert(rejected, label);
}

assertRecoveryExternalEffectFenceBinding(intent, fence);
console.log("Day 70 / 1: matching trusted binding");

mustReject("missing fence", intent, undefined);
console.log("Day 70 / 2: missing fence denied");

mustReject("other command", intent, { ...fence, commandId: "other-command" });
console.log("Day 70 / 3: other command denied");

mustReject("other tenant", intent, { ...fence, tenantId: "other-tenant" });
console.log("Day 70 / 4: cross-tenant fence denied");

mustReject("changed key", intent, { ...fence, idempotencyKey: "other-key" });
console.log("Day 70 / 5: mismatched idempotency key denied");

mustReject("stale revision", intent, {
  ...fence,
  authorizationRevisions: {
    ...fence.authorizationRevisions,
    actorGrantRevision: 10
  }
});
console.log("Day 70 / 6: mismatched grant revision denied");

mustReject("invalid epoch", intent, { ...fence, epoch: 0 });
console.log("Day 70 / 7: invalid epoch denied");

mustReject("different owner", intent, { ...fence, owner: "legacy" });
console.log("Day 70 / 8: owner mismatch denied");

console.log("Day 70 morning: 8 pure contract assertions passed (no external effect executed)");
