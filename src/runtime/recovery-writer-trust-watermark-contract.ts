/**
 * Day 83 morning: TRUSTED POLICY WATERMARK CONTRACT, not an implementation
 * of certificate authentication, signature verification, durable storage or
 * rollout. The caller may NOT construct a trusted policy from RPC JSON.
 */
export interface RecoveryWriterTrustWatermark {
  readonly deploymentId: string;
  /** Monotonically increasing policy generation, provisioned by a trusted policy authority. */
  readonly revision: number;
  /** SHA-256 of canonical *complete* policy bytes; hash is identity, NOT authenticity. */
  readonly policySha256: string;
}

/**
 * A trusted, access-controlled, DURABLE + LINEARIZABLE store.
 * Never implement as process-local Map. CAS must atomically compare the
 * existing (deploymentId, revision, policySha256) and replace it with next.
 */
export interface RecoveryWriterTrustWatermarkStore {
  load(deploymentId: string): Promise<RecoveryWriterTrustWatermark | null>;
  compareAndSwap(
    expected: RecoveryWriterTrustWatermark,
    next: RecoveryWriterTrustWatermark
  ): Promise<"advanced" | "conflict">;
}

/**
 * A server-side authenticated source (not a browser request, forwarded header
 * or arbitrary JSON). Implementations must independently authenticate policy
 * provenance and compute its canonical SHA-256 digest.
 */
export interface AuthenticatedRecoveryWriterPolicySource {
  getCurrent(deploymentId: string): Promise<{
    readonly watermark: RecoveryWriterTrustWatermark;
    readonly rawPolicyBytes: Uint8Array;
  } | null>;
}

export type RecoveryWriterTrustBootstrapReview =
  | Readonly<{
      action: "ready_for_isolated_bootstrap_test";
      mode: "exact_restart_replay" | "advance_requires_durable_cas";
      publishAuthorized: false;
    }>
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>;

const DEPLOYMENT = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
const hold = (reason: string): RecoveryWriterTrustBootstrapReview => ({
  action: "hold", reason, publishAuthorized: false
});

function valid(value: RecoveryWriterTrustWatermark | null): value is RecoveryWriterTrustWatermark {
  return value !== null && typeof value === "object" &&
    typeof value.deploymentId === "string" && DEPLOYMENT.test(value.deploymentId) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.policySha256 === "string" && SHA256.test(value.policySha256);
}

/**
 * Pure decision guard ONLY. trustedSourceAuthenticated may be asserted solely
 * by a server-owned verifier; it is NOT an authentication mechanism itself.
 * A successful review does NOT persist CAS or activate a policy.
 *
 * Exact (revision, digest) replay is allowed for crash/restart recovery.
 * An equal revision with different content is forbidden.
 */
export function reviewRecoveryWriterTrustBootstrap(input: Readonly<{
  deploymentId: string;
  trustedSourceAuthenticated: boolean;
  durable: RecoveryWriterTrustWatermark | null;
  candidate: RecoveryWriterTrustWatermark;
}>): RecoveryWriterTrustBootstrapReview {
  if (!input || typeof input.deploymentId !== "string" ||
      !DEPLOYMENT.test(input.deploymentId)) return hold("deployment_invalid");
  if (input.trustedSourceAuthenticated !== true) return hold("policy_source_untrusted");
  // No TOFU: the deployment must have a trusted, provisioned anchor.
  if (!valid(input.durable)) return hold("durable_trust_anchor_unavailable");
  if (!valid(input.candidate)) return hold("candidate_policy_invalid");
  if (input.durable.deploymentId !== input.deploymentId ||
      input.candidate.deploymentId !== input.deploymentId) {
    return hold("policy_deployment_mismatch");
  }
  if (input.candidate.revision < input.durable.revision) {
    return hold("trust_policy_rollback");
  }
  if (input.candidate.revision === input.durable.revision) {
    if (input.candidate.policySha256.toLowerCase() !==
        input.durable.policySha256.toLowerCase()) return hold("same_revision_different_policy");
    return { action: "ready_for_isolated_bootstrap_test",
      mode: "exact_restart_replay", publishAuthorized: false };
  }
  return { action: "ready_for_isolated_bootstrap_test",
    mode: "advance_requires_durable_cas", publishAuthorized: false };
}
