/**
 * Day 90 evening: read-only, fail-closed release blocker register.
 *
 * This is NOT a production release gate. Caller-supplied receipts, observer
 * labels, host lists, lab hazards and digests are not authenticated evidence.
 * No input or combination of inputs can return production GO.
 */
import {
  reviewWriterCutoverEvidenceCoverage,
  type WriterCutoverEvidenceReceipt,
  type WriterCutoverEvidenceScope
} from "./recovery-writer-cutover-evidence-coverage.js";
import {
  mapLocalLabsToCutoverUnknownMatrix,
  type Day90LocalLabSignal
} from "./recovery-writer-cutover-local-evidence.js";

export const DAY90_FIXTURE_HAZARDS = [
  "old_fd_writable_after_chmod",
  "rollback_restores_new_write_access"
] as const;
export type Day90FixtureHazard = typeof DAY90_FIXTURE_HAZARDS[number];

export interface Day90ReleaseBlockerInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly nowEpochMs: number;
  readonly receipts: ReadonlyArray<WriterCutoverEvidenceReceipt>;
  /** Disposable lab reports, never authenticated deployment evidence. */
  readonly localSignals: ReadonlyArray<Day90LocalLabSignal>;
  readonly observedFixtureHazards: ReadonlyArray<Day90FixtureHazard>;
}

export interface Day90ReleaseBlockerDecision {
  readonly action: "hold";
  readonly reasons: ReadonlyArray<string>;
  readonly unknownCells: number;
  readonly callerSuppliedReceiptCount: number;
  readonly independentlyAttestedReceiptCount: 0;
  readonly observedFixtureHazards: ReadonlyArray<Day90FixtureHazard>;
  readonly publishAuthorized: false;
}

function hold(
  reasons: string[],
  unknownCells = 0,
  callerSuppliedReceiptCount = 0,
  hazards: ReadonlyArray<Day90FixtureHazard> = []
): Day90ReleaseBlockerDecision {
  return {
    action: "hold", reasons, unknownCells, callerSuppliedReceiptCount,
    independentlyAttestedReceiptCount: 0,
    observedFixtureHazards: hazards, publishAuthorized: false
  };
}

/**
 * Produces an explicit NO_GO explanation for Day 90's coverage matrix.
 * The caller cannot assert verification of host inventory, signing identity,
 * challenge consumption, OS isolation, rollback enforcement or Consumer ACK.
 */
export function reviewDay90ReleaseBlockers(
  input: Day90ReleaseBlockerInput
): Day90ReleaseBlockerDecision {
  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release") ||
      !Array.isArray(input.receipts) ||
      !Array.isArray(input.localSignals) ||
      !Array.isArray(input.observedFixtureHazards) ||
      input.observedFixtureHazards.some(h => !DAY90_FIXTURE_HAZARDS.includes(h)) ||
      new Set(input.observedFixtureHazards).size !== input.observedFixtureHazards.length) {
    return hold(["review_input_invalid"]);
  }

  let matrix: ReturnType<typeof mapLocalLabsToCutoverUnknownMatrix>;
  try {
    matrix = mapLocalLabsToCutoverUnknownMatrix({
      scope: input.scope,
      nowEpochMs: input.nowEpochMs,
      signals: input.localSignals
    });
  } catch {
    return hold(["scope_or_local_lab_invalid"], 0, input.receipts.length,
      input.observedFixtureHazards);
  }

  // Coverage validates metadata only. It must not be called with production
  // intent here, since we want the detailed missing/duplicate/misbound reason.
  const coverage = reviewWriterCutoverEvidenceCoverage({
    intent: "isolated_review",
    scope: input.scope,
    nowEpochMs: input.nowEpochMs,
    receipts: input.receipts
  });

  const reasons: string[] = [];
  if (input.intent === "production_release") {
    reasons.push("production_release_not_authorized");
  }
  if (coverage.action === "hold") {
    reasons.push("coverage:" + coverage.reason);
  } else {
    reasons.push("coverage_is_only_untrusted_metadata");
  }
  reasons.push("trusted_deployment_host_inventory_missing");
  reasons.push("full_host_pid_fd_mount_and_rollback_attestation_missing");
  reasons.push("pinned_collector_signature_and_atomic_challenge_chain_missing");
  reasons.push("independent_consumer_ack_and_raw_ingress_proof_missing");
  if (matrix.localSignalCount > 0) {
    reasons.push("disposable_lab_signals_not_deployment_receipts");
  }
  for (const hazard of input.observedFixtureHazards) {
    reasons.push("reproduced_unsafe_fixture:" + hazard);
  }

  return hold(reasons, matrix.cells.length, input.receipts.length,
    input.observedFixtureHazards);
}
