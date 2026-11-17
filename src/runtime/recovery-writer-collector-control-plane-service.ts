/**
 * Day 88 noon: isolated authenticated-ingress *adapter* and durable-audit routing.
 *
 * The peer is injected by the host-controlled resolver, NEVER copied from
 * request JSON. This is not a production mTLS implementation or OS isolation.
 * The underlying Day 87 lab store still exposes legacy admin methods.
 */
import {
  type CollectorControlPeer,
  type CollectorControlCommand
} from "./recovery-writer-collector-control-plane-admission.js";
import {
  SQLiteWriterCollectorChallengeStore,
  type AuditedCollectorControlResult,
  type CollectorControlMutationPayload
} from "./recovery-writer-collector-challenge-store.js";

export interface LabCollectorControlPlaneContext {
  readonly deploymentId: string;
  readonly releaseId: string;
  /** Only a trusted service ingress may supply this resolver. */
  readonly authenticatedPeer: () => CollectorControlPeer | null;
  readonly nowEpochMs: () => number;
}
export interface LabCollectorControlRequest {
  readonly requestId: string;
  readonly intent: "isolated_review" | "production_release";
  readonly command: CollectorControlCommand;
  readonly payload: CollectorControlMutationPayload;
}
export class IsolatedCollectorControlPlaneService {
  constructor(
    private readonly store: SQLiteWriterCollectorChallengeStore,
    private readonly trusted: LabCollectorControlPlaneContext
  ) {}

  /** Request never accepts an authenticatedPeer, principal role, or ACL. */
  execute(request: LabCollectorControlRequest): AuditedCollectorControlResult {
    return this.store.executeAuditedControlCommand({
      requestId: request.requestId,
      admission: {
        intent: request.intent,
        expectedDeploymentId: this.trusted.deploymentId,
        expectedReleaseId: this.trusted.releaseId,
        nowEpochMs: this.trusted.nowEpochMs(),
        authenticatedPeer: this.trusted.authenticatedPeer(),
        command: request.command
      },
      payload: request.payload
    });
  }
}
