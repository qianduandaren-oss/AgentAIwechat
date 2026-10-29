import type { DurableRecoveryOperationCommand } from "./durable-recovery-operation-orchestrator.js";
import type { AuthenticatedRecoveryPrincipal } from "./recovery-ingress-gate.js";
import type { RecoveryOperation } from "./recovery-operations.js";
import type { RecoveryClaimOwner, SharedRecoveryOwnershipClaim } from "./recovery-shared-ownership-claim.js";

/**
 * Day 69 MORNING: contract only. No production ACL authority or atomic
 * authorization+claim implementation is wired yet.
 *
 * These revisions MUST come from trusted authoritative state. A timestamp,
 * request JSON field, or caller-supplied revision is not authorization proof.
 */
export interface RecoveryAuthorizationRevisions {
  runTenantRevision: number;
  runAclRevision: number;
  actorGrantRevision: number;
}

/** Server-created authorization evidence, never accepted from request JSON. */
export interface RecoveryAuthorizationEvidence {
  actorId: string;
  tenantId: string;
  runId: string;
  operation: RecoveryOperation;
  allowed: true;
  revisions: RecoveryAuthorizationRevisions;
}

/**
 * An authoritative adapter would read Run membership and ACL/grants.
 * It should fail closed on missing revision information.
 */
export interface RecoveryAuthorizationEvidenceAuthority {
  authorize(
    command: DurableRecoveryOperationCommand,
    principal: AuthenticatedRecoveryPrincipal
  ): Promise<RecoveryAuthorizationEvidence | undefined>;
}

/**
 * Desired future transaction boundary, NOT implemented by the existing
 * SharedRecoveryOwnershipClaimer.claim().
 *
 * Implementations must compare all current authoritative revisions AND
 * validate permission and Run tenant ownership within the same transaction
 * that inserts/claims the Command. If ACL state lives outside that atomic
 * authority, a simple second read is insufficient: fail closed or introduce
 * a documented cross-system fencing protocol before production use.
 */
export interface TransactionalAuthorizedRecoveryClaimer {
  claimAuthorized(
    command: DurableRecoveryOperationCommand,
    owner: RecoveryClaimOwner,
    evidence: RecoveryAuthorizationEvidence
  ): Promise<SharedRecoveryOwnershipClaim>;
}

export class RecoveryAuthorizationEvidenceConflictError extends Error {
  constructor() {
    super("Recovery authorization evidence is absent, invalid or stale");
    this.name = "RecoveryAuthorizationEvidenceConflictError";
  }
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Pure invariant check. Prevents accidental evidence/identity mix-up,
 * but does NOT prove the actor is authorized or remove the Claim TOCTOU.
 */
export function assertRecoveryAuthorizationEvidence(
  command: DurableRecoveryOperationCommand,
  principal: AuthenticatedRecoveryPrincipal,
  evidence: RecoveryAuthorizationEvidence | undefined
): asserts evidence is RecoveryAuthorizationEvidence {
  if (!evidence || evidence.allowed !== true ||
      evidence.actorId !== principal.actorId ||
      evidence.tenantId !== principal.tenantId ||
      evidence.actorId !== command.requestedBy ||
      evidence.runId !== command.runId ||
      evidence.operation !== command.operation ||
      !evidence.revisions ||
      !revision(evidence.revisions.runTenantRevision) ||
      !revision(evidence.revisions.runAclRevision) ||
      !revision(evidence.revisions.actorGrantRevision)) {
    throw new RecoveryAuthorizationEvidenceConflictError();
  }
}

/**
 * Invariant used by tests and future Claim implementation.
 * It only compares two supplied snapshots. The CURRENT snapshot must
 * be read atomically from the real authority to enforce fencing.
 */
export function assertRecoveryAuthorizationRevisionsUnchanged(
  admitted: RecoveryAuthorizationRevisions,
  current: RecoveryAuthorizationRevisions
): void {
  for (const key of ["runTenantRevision", "runAclRevision", "actorGrantRevision"] as const) {
    if (!revision(admitted[key]) || !revision(current[key]) ||
        admitted[key] !== current[key]) {
      throw new RecoveryAuthorizationEvidenceConflictError();
    }
  }
}
