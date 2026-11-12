import { createHash } from "node:crypto";
import { RecoveryWriterMtlsTrustController } from "./recovery-writer-mtls-trust-controller.js";
import type { RecoveryWriterMtlsTrustSnapshot } from "./recovery-writer-mtls-trust-controller.js";
import {
  reviewRecoveryWriterTrustBootstrap,
  type AuthenticatedRecoveryWriterPolicySource,
  type RecoveryWriterTrustWatermark,
  type RecoveryWriterTrustWatermarkStore
} from "./recovery-writer-trust-watermark-contract.js";

/**
 * Day 83 noon: cold-start laboratory bootstrap only.
 * Source.getCurrent MUST authenticate the publisher independently; digest
 * checks byte identity, not provenance. Caller must keep network ingress
 * DISABLED until this function succeeds. No hot rollout / multi-node invalidation.
 */
export async function bootstrapRecoveredWriterTrust(input: Readonly<{
  deploymentId: string;
  source: AuthenticatedRecoveryWriterPolicySource;
  store: RecoveryWriterTrustWatermarkStore;
  nowEpochMs: () => number;
}>): Promise<
  | { action: "ready_for_isolated_bootstrap_test"; mode: "exact_restart_replay" | "advance_requires_durable_cas";
      controller: RecoveryWriterMtlsTrustController; activeWatermark: RecoveryWriterTrustWatermark; publishAuthorized: false }
  | { action: "hold"; reason: string; publishAuthorized: false }
> {
  const hold = (reason: string) => ({ action: "hold" as const, reason, publishAuthorized: false as const });
  try {
    const durable = await input.store.load(input.deploymentId);
    if (!durable) return hold("durable_trust_anchor_unavailable");
    // Only the server-owned AuthenticatedRecoveryWriterPolicySource may implement this.
    const supplied = await input.source.getCurrent(input.deploymentId);
    if (!supplied) return hold("trusted_policy_source_unavailable");
    const bytes = supplied.rawPolicyBytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 64_000 || bytes.byteLength === 0) {
      return hold("trusted_policy_bytes_invalid");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== supplied.watermark.policySha256.toLowerCase()) {
      return hold("trusted_policy_digest_mismatch");
    }
    const review = reviewRecoveryWriterTrustBootstrap({
      deploymentId: input.deploymentId, trustedSourceAuthenticated: true,
      durable, candidate: supplied.watermark
    });
    if (review.action === "hold") return hold(review.reason);
    const policy = JSON.parse(new TextDecoder().decode(bytes)) as RecoveryWriterMtlsTrustSnapshot;
    if (!policy || policy.deploymentId !== supplied.watermark.deploymentId ||
        policy.revision !== supplied.watermark.revision ||
        supplied.watermark.revision < 1) return hold("trusted_policy_snapshot_mismatch");

    // Explicitly construct a *new* controller ONLY for cold-start recovery.
    // Day 82 install requires revision > minimumRevision; the persistent
    // (revision,digest) comparison above makes exact replay safe at startup.
    const controller = new RecoveryWriterMtlsTrustController(
      input.deploymentId, input.nowEpochMs, supplied.watermark.revision - 1
    );
    const installed = controller.install(policy);
    if (installed.action !== "ready_for_isolated_rotation_test") {
      return hold(installed.reason);
    }
    if (review.mode === "advance_requires_durable_cas") {
      const changed = await input.store.compareAndSwap(durable, supplied.watermark);
      if (changed !== "advanced") return hold("durable_trust_cas_conflict");
    }
    return {
      action: "ready_for_isolated_bootstrap_test",
      mode: review.mode, controller,
      activeWatermark: Object.freeze({ ...supplied.watermark, policySha256: supplied.watermark.policySha256.toLowerCase() }),
      publishAuthorized: false
    };
  } catch {
    return hold("durable_trust_bootstrap_unavailable");
  }
}
