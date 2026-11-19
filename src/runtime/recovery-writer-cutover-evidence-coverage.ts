/**
 * Day 90 morning: two-phase, per-host cutover evidence coverage.
 * This is a metadata reconciliation boundary, NOT a signature verifier,
 * complete procfs inventory, privileged collector or production release gate.
 * Every result has publishAuthorized=false.
 */
import {
  WRITER_RELEASE_CHECKS,
  type WriterReleaseCheck
} from "./recovery-writer-release-evidence.js";

export const WRITER_CUTOVER_PHASES = ["preflight", "cutover"] as const;
export type WriterCutoverPhase = typeof WRITER_CUTOVER_PHASES[number];

export interface WriterCutoverTargetHost {
  readonly hostId: string;
  readonly mountNamespaceId: string;
}

export interface WriterCutoverEvidenceScope {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
  /** Trusted deployment controller must supply this independently. */
  readonly expectedHosts: ReadonlyArray<WriterCutoverTargetHost>;
}

export interface WriterCutoverEvidenceReceipt {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly attemptId: string;
  readonly hostId: string;
  readonly mountNamespaceId: string;
  readonly phase: WriterCutoverPhase;
  readonly check: WriterReleaseCheck;
  readonly status: "pass" | "fail" | "unknown";
  readonly observerKind: "independent_host_probe" | "worker_self_report";
  readonly observerId: string;
  readonly observedAtEpochMs: number;
  readonly artifactSha256: string;
}

export interface WriterCutoverCoverageInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly nowEpochMs: number;
  readonly receipts: ReadonlyArray<WriterCutoverEvidenceReceipt>;
}

export type WriterCutoverCoverageResult =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{
      action: "coverage_complete_for_isolated_attestation";
      receiptCount: number;
      publishAuthorized: false;
    }>;

const hold = (reason: string): WriterCutoverCoverageResult =>
  ({ action: "hold", reason, publishAuthorized: false });

const nonempty = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;
const keyFor = (phase: string, hostId: string, check: string): string =>
  JSON.stringify([phase, hostId, check]);

/**
 * A plan enumerates every expected host and all seven Day 86 checks twice.
 * It deliberately does not populate a PASS result or manufacture evidence.
 */
export function listRequiredCutoverEvidence(
  scope: WriterCutoverEvidenceScope
): ReadonlyArray<Readonly<{
    phase: WriterCutoverPhase;
    hostId: string;
    mountNamespaceId: string;
    check: WriterReleaseCheck;
  }>> {
  return WRITER_CUTOVER_PHASES.flatMap(phase =>
    scope.expectedHosts.flatMap(host =>
      WRITER_RELEASE_CHECKS.map(check => ({
        phase, hostId: host.hostId, mountNamespaceId: host.mountNamespaceId, check
      }))
    )
  );
}

/**
 * Check presence, target/attempt binding, observer labels, freshness and
 * preflight-before-cutover chronology. All metadata is caller-supplied and
 * forgeable. A complete fixture is NOT an authenticated host attestation.
 */
export function reviewWriterCutoverEvidenceCoverage(
  input: WriterCutoverCoverageInput
): WriterCutoverCoverageResult {
  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release")) return hold("intent_invalid");
  if (input.intent === "production_release") {
    return hold("production_os_evidence_not_attested");
  }
  const scope = input.scope;
  if (!scope || !nonempty(scope.deploymentId) || !nonempty(scope.releaseId) ||
      !nonempty(scope.attemptId) || !Array.isArray(scope.expectedHosts) ||
      scope.expectedHosts.length === 0) return hold("scope_incomplete");
  if (!Number.isSafeInteger(input.nowEpochMs)) return hold("review_clock_invalid");

  const knownHosts = new Map<string, string>();
  for (const host of scope.expectedHosts) {
    if (!host || !nonempty(host.hostId) || !nonempty(host.mountNamespaceId) ||
        knownHosts.has(host.hostId)) return hold("expected_host_invalid_or_duplicate");
    knownHosts.set(host.hostId, host.mountNamespaceId);
  }
  if (!Array.isArray(input.receipts)) return hold("receipts_missing");
  const seen = new Map<string, WriterCutoverEvidenceReceipt>();
  for (const receipt of input.receipts) {
    if (!receipt || receipt.deploymentId !== scope.deploymentId ||
        receipt.releaseId !== scope.releaseId ||
        receipt.attemptId !== scope.attemptId) return hold("receipt_target_or_attempt_mismatch");
    if (!knownHosts.has(receipt.hostId) ||
        knownHosts.get(receipt.hostId) !== receipt.mountNamespaceId) {
      return hold("receipt_host_or_namespace_mismatch");
    }
    if (!WRITER_CUTOVER_PHASES.includes(receipt.phase) ||
        !WRITER_RELEASE_CHECKS.includes(receipt.check)) {
      return hold("receipt_phase_or_check_invalid");
    }
    if (receipt.observerKind !== "independent_host_probe" ||
        !nonempty(receipt.observerId)) return hold("receipt_observer_untrusted");
    if (receipt.status !== "pass") return hold("receipt_not_proven:" + receipt.check);
    if (!/^[a-f0-9]{64}$/.test(receipt.artifactSha256)) {
      return hold("receipt_digest_invalid");
    }
    if (!Number.isSafeInteger(receipt.observedAtEpochMs) ||
        receipt.observedAtEpochMs > input.nowEpochMs ||
        input.nowEpochMs - receipt.observedAtEpochMs > 300_000) {
      return hold("receipt_stale_or_clock_invalid");
    }
    const key = keyFor(receipt.phase, receipt.hostId, receipt.check);
    if (seen.has(key)) return hold("receipt_duplicate");
    seen.set(key, receipt);
  }
  const required = listRequiredCutoverEvidence(scope);
  for (const item of required) {
    const key = keyFor(item.phase, item.hostId, item.check);
    if (!seen.has(key)) {
      return hold("receipt_missing:" + item.phase + ":" + item.hostId + ":" + item.check);
    }
  }
  // Require that the cutover checkpoint is actually newer for every host/check.
  for (const host of scope.expectedHosts) {
    for (const check of WRITER_RELEASE_CHECKS) {
      const pre = seen.get(keyFor("preflight", host.hostId, check));
      const post = seen.get(keyFor("cutover", host.hostId, check));
      if (!pre || !post || post.observedAtEpochMs <= pre.observedAtEpochMs) {
        return hold("cutover_not_after_preflight");
      }
    }
  }
  return {
    action: "coverage_complete_for_isolated_attestation",
    receiptCount: seen.size,
    publishAuthorized: false
  };
}
