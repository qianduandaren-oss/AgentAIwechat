/**
 * Day 90 noon: disposable lab signals are NOT authenticated host evidence.
 * The entire cutover coverage matrix stays UNKNOWN, never production-ready.
 */
import {
  listRequiredCutoverEvidence, reviewWriterCutoverEvidenceCoverage,
  WRITER_CUTOVER_PHASES,
  type WriterCutoverEvidenceScope, type WriterCutoverPhase
} from "./recovery-writer-cutover-evidence-coverage.js";
import type { WriterReleaseCheck } from "./recovery-writer-release-evidence.js";

export type Day90LocalSignalKind =
  | "day86_owned_child_writable_sqlite_fd"
  | "day89_disposable_uid_new_open_denial";
export interface Day90LocalLabSignal {
  readonly kind: Day90LocalSignalKind;
  readonly phase: WriterCutoverPhase;
  readonly hostId: string;
  readonly mountNamespaceId: string;
  readonly observedAtEpochMs: number;
  readonly rawArtifactSha256: string;
}
export interface Day90CutoverUnknownCell {
  readonly phase: WriterCutoverPhase;
  readonly hostId: string;
  readonly mountNamespaceId: string;
  readonly check: WriterReleaseCheck;
  readonly status: "unknown";
  /** Related local facts, NOT proof this deployment-wide check passed. */
  readonly fixtureSignals: ReadonlyArray<Day90LocalSignalKind>;
}
export interface Day90LocalCutoverMatrix {
  readonly action: "hold";
  readonly reason: "disposable_fixture_not_deployment_attestation";
  readonly cells: ReadonlyArray<Day90CutoverUnknownCell>;
  readonly localSignalCount: number;
  readonly acceptedHostReceiptCount: 0;
  readonly coverageHoldReason: string;
  readonly publishAuthorized: false;
}
const relatedCheck: Readonly<Record<Day90LocalSignalKind, WriterReleaseCheck>> = {
  day86_owned_child_writable_sqlite_fd: "legacy_writable_fds_drained",
  day89_disposable_uid_new_open_denial: "legacy_db_wal_shm_denied"
};
function checkScope(scope: WriterCutoverEvidenceScope): void {
  if (!scope || !scope.deploymentId?.trim() || !scope.releaseId?.trim() ||
      !scope.attemptId?.trim() || !Array.isArray(scope.expectedHosts) ||
      !scope.expectedHosts.length) throw Error("FAIL_CLOSED: scope_invalid");
  const ids = new Set<string>();
  for (const h of scope.expectedHosts) {
    if (!h?.hostId?.trim() || !h.mountNamespaceId?.trim() || ids.has(h.hostId))
      throw Error("FAIL_CLOSED: scope_host_invalid");
    ids.add(h.hostId);
  }
}
/** Maps partial, untrusted lab observations to notes, NEVER pass receipts. */
export function mapLocalLabsToCutoverUnknownMatrix(input: {
  readonly scope: WriterCutoverEvidenceScope;
  readonly nowEpochMs: number;
  readonly signals: ReadonlyArray<Day90LocalLabSignal>;
}): Day90LocalCutoverMatrix {
  checkScope(input.scope);
  if (!Number.isSafeInteger(input.nowEpochMs)) throw Error("FAIL_CLOSED: review_clock_invalid");
  if (!Array.isArray(input.signals)) throw Error("FAIL_CLOSED: signals_invalid");
  const hostNs = new Map(input.scope.expectedHosts.map(h => [h.hostId, h.mountNamespaceId]));
  const seen = new Set<string>();
  for (const signal of input.signals) {
    if (!signal || !Object.hasOwn(relatedCheck, signal.kind) ||
        !WRITER_CUTOVER_PHASES.includes(signal.phase) ||
        !hostNs.has(signal.hostId) ||
        hostNs.get(signal.hostId) !== signal.mountNamespaceId) {
      throw Error("FAIL_CLOSED: local_signal_target_invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(signal.rawArtifactSha256) ||
        !Number.isSafeInteger(signal.observedAtEpochMs) ||
        signal.observedAtEpochMs > input.nowEpochMs ||
        input.nowEpochMs - signal.observedAtEpochMs > 300_000) {
      throw Error("FAIL_CLOSED: local_signal_digest_or_freshness_invalid");
    }
    const id = JSON.stringify([signal.kind, signal.phase, signal.hostId]);
    if (seen.has(id)) throw Error("FAIL_CLOSED: local_signal_duplicate");
    seen.add(id);
  }
  const cells: Day90CutoverUnknownCell[] =
    listRequiredCutoverEvidence(input.scope).map(item => ({
      ...item,
      status: "unknown",
      fixtureSignals: input.signals
        .filter(s => s.hostId === item.hostId &&
          s.mountNamespaceId === item.mountNamespaceId &&
          s.phase === item.phase && relatedCheck[s.kind] === item.check)
        .map(s => s.kind)
    }));
  // No signed/attested receipts were obtained; do NOT fabricate PASS rows.
  const coverage = reviewWriterCutoverEvidenceCoverage({
    intent: "isolated_review", scope: input.scope, nowEpochMs: input.nowEpochMs,
    receipts: []
  });
  if (coverage.action !== "hold") throw Error("FAIL_CLOSED: unexpected_coverage_authorization");
  return {
    action: "hold", reason: "disposable_fixture_not_deployment_attestation",
    cells, localSignalCount: input.signals.length, acceptedHostReceiptCount: 0,
    coverageHoldReason: coverage.reason, publishAuthorized: false
  };
}
