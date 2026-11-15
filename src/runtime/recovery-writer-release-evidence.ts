/**
 * Day 86 morning — release-evidence envelope review.
 * Advisory contract only: SHA-256-shaped strings and observer labels do not
 * authenticate a collector or prove what the OS actually enforced.
 * This code NEVER returns production authorization.
 */
export const WRITER_RELEASE_CHECKS = [
  "legacy_processes_exited",
  "legacy_writable_fds_drained",
  "legacy_db_wal_shm_denied",
  "legacy_remount_denied",
  "rollback_keeps_legacy_denied",
  "single_writer_mount_verified",
  "raw_ack_ingress_disabled"
] as const;

export type WriterReleaseCheck = typeof WRITER_RELEASE_CHECKS[number];

export interface WriterReleaseObservation {
  readonly check: WriterReleaseCheck;
  readonly status: "pass" | "fail" | "unknown";
  readonly artifactSha256: string;
}

export interface WriterReleaseEvidenceEnvelope {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly observerId: string;
  readonly observerKind: "independent_host_probe" | "worker_self_report";
  readonly observedAtEpochMs: number;
  readonly observations: ReadonlyArray<WriterReleaseObservation>;
}

export interface WriterReleaseEvidenceReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly nowEpochMs: number;
  readonly evidence: WriterReleaseEvidenceEnvelope | null;
}

export type WriterReleaseEvidenceReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_deployment_probe"; publishAuthorized: false }>;

const hold = (reason: string): WriterReleaseEvidenceReview =>
  ({ action: "hold", reason, publishAuthorized: false });

/**
 * This validates structure, binding, freshness and completeness of UNTRUSTED
 * metadata only. Proof must be independently collected and verified by the
 * deployment platform. No self-reported JSON can grant database write access.
 */
export function reviewWriterReleaseEvidence(
  input: WriterReleaseEvidenceReviewInput
): WriterReleaseEvidenceReview {
  if (!input || input.intent !== "isolated_review" &&
      input.intent !== "production_release") return hold("intent_invalid");
  if (input.intent === "production_release") {
    return hold("production_isolation_not_independently_verified");
  }
  if (!input.deploymentId?.trim() || !input.releaseId?.trim()) {
    return hold("target_identity_missing");
  }
  const evidence = input.evidence;
  if (!evidence) return hold("evidence_missing");
  if (evidence.deploymentId !== input.deploymentId ||
      evidence.releaseId !== input.releaseId) {
    return hold("evidence_target_mismatch");
  }
  if (evidence.observerKind !== "independent_host_probe" ||
      !evidence.observerId?.trim()) {
    return hold("independent_observer_missing");
  }
  // Bounded local lab freshness check, NOT authentication or a trusted clock.
  if (!Number.isSafeInteger(input.nowEpochMs) ||
      !Number.isSafeInteger(evidence.observedAtEpochMs) ||
      evidence.observedAtEpochMs > input.nowEpochMs ||
      input.nowEpochMs - evidence.observedAtEpochMs > 5 * 60_000) {
    return hold("evidence_stale_or_clock_invalid");
  }
  if (!Array.isArray(evidence.observations)) return hold("observations_missing");
  const seen = new Set<string>();
  for (const observation of evidence.observations) {
    if (!observation || !WRITER_RELEASE_CHECKS.includes(observation.check) ||
        seen.has(observation.check)) return hold("duplicate_or_unknown_check");
    seen.add(observation.check);
    if (observation.status !== "pass") {
      return hold("check_not_proven:" + observation.check);
    }
    if (!/^[a-f0-9]{64}$/.test(observation.artifactSha256)) {
      return hold("artifact_digest_invalid:" + observation.check);
    }
  }
  for (const check of WRITER_RELEASE_CHECKS) {
    if (!seen.has(check)) return hold("check_missing:" + check);
  }
  return { action: "ready_for_isolated_deployment_probe", publishAuthorized: false };
}
