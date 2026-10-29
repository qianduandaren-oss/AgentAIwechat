import {
  assertRecoveryAuthorizationEvidence,
  assertRecoveryAuthorizationRevisionsUnchanged,
  RecoveryAuthorizationEvidenceConflictError,
  type RecoveryAuthorizationEvidence
} from "../runtime/recovery-authorization-evidence.js";

const principal = { actorId: "operator-a", tenantId: "tenant-a" };
const command = {
  commandId: "day69-command", runId: "run-1",
  operation: "quarantine" as const, reason: "manual review",
  requestedBy: principal.actorId,
  expectedCheckpointVersion: 1,
  expectedControlVersion: 0
};
const evidence: RecoveryAuthorizationEvidence = {
  actorId: principal.actorId, tenantId: principal.tenantId,
  runId: command.runId, operation: command.operation,
  allowed: true,
  revisions: {
    runTenantRevision: 4, runAclRevision: 11, actorGrantRevision: 9
  }
};
function mustReject(fn: () => void, message: string): void {
  try { fn(); }
  catch (error) {
    if (error instanceof RecoveryAuthorizationEvidenceConflictError) return;
    throw error;
  }
  throw new Error("Expected fail-closed: " + message);
}

let passed = 0;
assertRecoveryAuthorizationEvidence(command, principal, evidence);
passed++;
mustReject(() => assertRecoveryAuthorizationEvidence(command, principal, undefined), "no evidence");
passed++;
mustReject(() => assertRecoveryAuthorizationEvidence(command, principal, { ...evidence, actorId: "operator-b" }), "other actor");
passed++;
mustReject(() => assertRecoveryAuthorizationEvidence(command, principal, { ...evidence, tenantId: "tenant-b" }), "other tenant");
passed++;
mustReject(() => assertRecoveryAuthorizationEvidence(command, principal, { ...evidence, runId: "run-2" }), "other run");
passed++;
mustReject(() => assertRecoveryAuthorizationEvidence(command, principal, { ...evidence, revisions: { ...evidence.revisions, actorGrantRevision: -1 } }), "invalid revision");
passed++;
assertRecoveryAuthorizationRevisionsUnchanged(evidence.revisions, { ...evidence.revisions });
passed++;
mustReject(() => assertRecoveryAuthorizationRevisionsUnchanged(evidence.revisions, { ...evidence.revisions, actorGrantRevision: 10 }), "grants revoked");
passed++;
mustReject(() => assertRecoveryAuthorizationRevisionsUnchanged(evidence.revisions, { ...evidence.revisions, runTenantRevision: 5 }), "run moved");
passed++;
mustReject(() => assertRecoveryAuthorizationRevisionsUnchanged(evidence.revisions, { ...evidence.revisions, runAclRevision: 12 }), "ACL changed");
passed++;
console.log(`Day 69 morning authorization evidence invariants: ${passed}/${passed} passed (pure contract only)`);
