import type { RecoveryWriterTrustWatermark } from "./recovery-writer-trust-watermark-contract.js";
import {
  assertRecoveryWriterTrustMatch,
  RecoveryWriterTrustFenceConflict
} from "./recovery-writer-transactional-trust-contract.js";

/**
 * Day 85 morning: pure advisory contract; NOT a production factory, trust
 * attestation, filesystem ownership proof or unforgeable TypeScript capability.
 *
 * Bootstrap and writer watermarks MUST be passed by trusted server startup,
 * never derived from untrusted RPC fields. The production branch intentionally
 * stays NO_GO until OS isolation and legacy construction paths are verified.
 */
export type RecoveryWriterCreationBoundaryReview =
  | Readonly<{
      action: "ready_for_isolated_factory_test";
      publishAuthorized: false;
      activeWatermark: RecoveryWriterTrustWatermark;
    }>
  | Readonly<{
      action: "hold";
      reason: string;
      publishAuthorized: false;
    }>;

export interface RecoveryWriterCreationBoundaryInput {
  readonly intent: "isolated_candidate" | "production_release";
  readonly entrypoint: "trust_bound_factory" | "legacy_constructor";
  readonly deploymentId: string;
  readonly trustedBootstrapWatermark: RecoveryWriterTrustWatermark | null;
  readonly writerWatermark: RecoveryWriterTrustWatermark | null;
}

const hold = (reason: string): RecoveryWriterCreationBoundaryReview => ({
  action: "hold", reason, publishAuthorized: false
});

export function reviewRecoveryWriterCreationBoundary(
  input: RecoveryWriterCreationBoundaryInput
): RecoveryWriterCreationBoundaryReview {
  if (!input || input.intent !== "isolated_candidate" &&
      input.intent !== "production_release") return hold("launch_intent_invalid");
  if (input.intent === "production_release") {
    return hold("production_os_and_legacy_isolation_not_verified");
  }
  if (input.entrypoint !== "trust_bound_factory") {
    return hold("legacy_unfenced_writer_forbidden");
  }
  if (!input.trustedBootstrapWatermark) {
    return hold("trusted_bootstrap_watermark_missing");
  }
  if (!input.writerWatermark) {
    return hold("writer_active_watermark_missing");
  }
  try {
    assertRecoveryWriterTrustMatch(
      input.trustedBootstrapWatermark, input.writerWatermark
    );
    if (input.trustedBootstrapWatermark.deploymentId !== input.deploymentId) {
      return hold("deployment_not_bound_to_trusted_bootstrap");
    }
  } catch (error) {
    if (error instanceof RecoveryWriterTrustFenceConflict) {
      return hold(error.reason);
    }
    return hold("construction_review_unavailable");
  }
  return {
    action: "ready_for_isolated_factory_test",
    activeWatermark: Object.freeze({ ...input.writerWatermark }),
    publishAuthorized: false
  };
}
