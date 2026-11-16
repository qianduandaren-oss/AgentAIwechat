/**
 * Day 88 morning: advisory admission boundary for collector control-plane actions.
 *
 * This pure function NEVER authenticates a caller, executes commands, or grants
 * production access. `peer` must originate in an authenticated ingress
 * adapter; JSON or a worker-provided "authenticated" flag cannot be trusted.
 */
export const COLLECTOR_CONTROL_OPERATIONS = [
  "provision_collector_key",
  "issue_challenge",
  "revoke_collector_key"
] as const;

export type CollectorControlOperation =
  typeof COLLECTOR_CONTROL_OPERATIONS[number];

export type CollectorControlRole =
  "release_admin" | "challenge_issuer" | "collector" | "runtime_worker";

export interface CollectorControlPeer {
  /** Authenticated identity resolved by the trusted ingress adapter. */
  readonly principalId: string;
  readonly role: CollectorControlRole;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly allowedOperations: readonly CollectorControlOperation[];
}

export interface CollectorControlCommand {
  readonly operation: CollectorControlOperation;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly keyId: string;
  /** Untrusted claim; compare with authenticated principal, never use as identity. */
  readonly claimedPrincipalId?: string;
}

export interface CollectorControlAdmissionInput {
  readonly intent: "isolated_review" | "production_release";
  readonly expectedDeploymentId: string;
  readonly expectedReleaseId: string;
  readonly nowEpochMs: number;
  /** Null on failed auth. Do not accept this object from a request body. */
  readonly authenticatedPeer: CollectorControlPeer | null;
  readonly command: CollectorControlCommand | null;
}

export interface CollectorControlAuditEvent {
  readonly schemaVersion: 1;
  readonly atEpochMs: number;
  readonly principalId: string;
  readonly operation: string;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly decision: "deny" | "candidate";
  readonly reason: string;
}

export type CollectorControlAdmissionReview =
  | Readonly<{
      action: "hold";
      reason: string;
      audit: CollectorControlAuditEvent;
      publishAuthorized: false;
    }>
  | Readonly<{
      action: "ready_for_isolated_control_plane_test";
      reason: "isolated_admission_candidate";
      audit: CollectorControlAuditEvent;
      publishAuthorized: false;
    }>;

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const validId = (s: unknown): s is string =>
  typeof s === "string" && ID.test(s);
const validOperation = (o: unknown): o is CollectorControlOperation =>
  COLLECTOR_CONTROL_OPERATIONS.some(x => x === o);
const roleAllows = (role: CollectorControlRole, op: CollectorControlOperation): boolean =>
  role === "release_admin"
    ? op === "provision_collector_key" || op === "revoke_collector_key"
    : role === "challenge_issuer" && op === "issue_challenge";

/**
 * Advisory only. Returning "ready" MUST NOT result in direct database mutation
 * without authenticated service routing, OS-level write isolation and durable audit.
 */
export function reviewCollectorControlPlaneCommand(
  input: CollectorControlAdmissionInput
): CollectorControlAdmissionReview {
  const peer = input?.authenticatedPeer;
  const cmd = input?.command;
  const now = Number.isSafeInteger(input?.nowEpochMs) && input.nowEpochMs >= 0
    ? input.nowEpochMs : 0;
  const auditBase = {
    schemaVersion: 1 as const,
    atEpochMs: now,
    principalId: validId(peer?.principalId) ? peer.principalId : "unverified",
    operation: validOperation(cmd?.operation) ? cmd.operation : "invalid",
    deploymentId: validId(input?.expectedDeploymentId) ? input.expectedDeploymentId : "invalid",
    releaseId: validId(input?.expectedReleaseId) ? input.expectedReleaseId : "invalid"
  };
  const hold = (reason: string): CollectorControlAdmissionReview => ({
    action: "hold", reason, publishAuthorized: false,
    audit: { ...auditBase, decision: "deny", reason }
  });

  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release")) return hold("intent_invalid");
  if (input.intent === "production_release") return hold("production_control_not_authorized");
  if (!validId(input.expectedDeploymentId) || !validId(input.expectedReleaseId) ||
      !Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    return hold("trusted_release_context_invalid");
  }
  if (!peer || !validId(peer.principalId) || !validId(peer.deploymentId) ||
      !validId(peer.releaseId) || !Array.isArray(peer.allowedOperations)) {
    return hold("authenticated_peer_missing");
  }
  if (!cmd || !validOperation(cmd.operation) || !validId(cmd.deploymentId) ||
      !validId(cmd.releaseId) || !validId(cmd.keyId)) {
    return hold("command_invalid");
  }
  if (peer.deploymentId !== input.expectedDeploymentId ||
      peer.releaseId !== input.expectedReleaseId ||
      cmd.deploymentId !== input.expectedDeploymentId ||
      cmd.releaseId !== input.expectedReleaseId) return hold("release_scope_mismatch");
  if (cmd.claimedPrincipalId !== undefined &&
      cmd.claimedPrincipalId !== peer.principalId) return hold("principal_claim_mismatch");
  if (!roleAllows(peer.role, cmd.operation)) return hold("role_forbidden");
  if (!peer.allowedOperations.includes(cmd.operation)) return hold("operation_not_granted");

  return {
    action: "ready_for_isolated_control_plane_test",
    reason: "isolated_admission_candidate",
    audit: {
      ...auditBase, decision: "candidate", reason: "isolated_admission_candidate"
    },
    publishAuthorized: false
  };
}
