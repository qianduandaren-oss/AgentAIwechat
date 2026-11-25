/** Day 96 evening: diagnostic composition, never a writer or a capability issuer. */
import { reviewDay95LifecycleReleaseBoundary, type Day95LifecycleReleaseInput }
  from "./recovery-writer-audit-gateway-lifecycle-release-boundary.js";
import type { Day96LabScope } from "./recovery-writer-atomic-authorization-fence-lab.js";

export interface Day96LabObservation {
  readonly scope: Day96LabScope;
  readonly status: string;
  readonly effectCount: number;
}

function summarize(input: Day95LifecycleReleaseInput, observed?: Day96LabObservation) {
  if (!observed) return { labReason: "lab_observation_missing", labEffectCount: null };
  const s = observed.scope;
  if (!s || s.deploymentId !== input.scope.deploymentId ||
      s.releaseId !== input.scope.releaseId || s.attemptId !== input.scope.attemptId ||
      typeof s.resourceId !== "string" || !s.resourceId.trim())
    return { labReason: "lab_observation_scope_mismatch", labEffectCount: null };
  const count = observed.effectCount;
  if (!Number.isSafeInteger(count) || count < 0 ||
      !["stale_fence","effect_committed","exact_effect_replay"].includes(observed.status) ||
      (observed.status === "stale_fence" ? count !== 0 : count !== 1))
    return { labReason: "lab_observation_inconsistent_or_unsupported", labEffectCount: null };
  return { labReason: "fixture_" + observed.status + "_not_authority", labEffectCount: count };
}

/** A caller-supplied observation is diagnostic metadata, not authenticated evidence.
 * No lab initialize/issue/revoke/consume call, and no permission conversion. */
export async function reviewDay96AtomicReleaseBoundary(
  input: Day95LifecycleReleaseInput, observed?: Day96LabObservation
) {
  const prior = await reviewDay95LifecycleReleaseBoundary(input);
  let lab: ReturnType<typeof summarize> = { labReason: "lab_not_evaluated", labEffectCount: null };
  if (input?.intent === "isolated_review") {
    try { lab = summarize(input, observed); }
    catch { lab = { labReason: "lab_observation_read_failed", labEffectCount: null }; }
  }
  return {
    ...prior, ...lab, labObservationTrusted: false as const,
    action: "hold" as const, publishAuthorized: false as const,
    authenticatedEvidenceCount: 0 as const, authenticatedExternalAnchorCount: 0 as const,
    blockers: Array.from(new Set([
      ...prior.blockers, "lab:" + lab.labReason,
      "same_transaction_lab_does_not_prove_production_authority",
      "remote_resource_fence_enforcement_unverified",
      "production_release_not_authorized"
    ]))
  };
}
