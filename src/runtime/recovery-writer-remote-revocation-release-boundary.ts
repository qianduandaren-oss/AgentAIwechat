/** Day 97 evening: diagnostic-only composition; no controller/resource mutation. */
import { reviewDay96AtomicReleaseBoundary, type Day96LabObservation }
  from "./recovery-writer-atomic-authorization-release-boundary.js";
import type { Day95LifecycleReleaseInput }
  from "./recovery-writer-audit-gateway-lifecycle-release-boundary.js";
import type { Day97Head } from "./recovery-writer-remote-revocation-barrier-lab.js";

export interface Day97BarrierObservation {
  scope: { deploymentId: string; releaseId: string; attemptId: string };
  barrierId: string;
  /** Both inventory and observations are caller-supplied, not authoritative. */
  expectedResourceIds: readonly string[];
  targets: readonly {
    resourceId: string; expectedFloor: number; expectedCommandSha256: string;
    ackRecorded: boolean; head: Day97Head | null; oldEffectCount: number;
  }[];
}
const id = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(x);
const sha = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function summary(barrierReason: string, requiredTargets: number | null = null,
  ackedTargets: number | null = null, matchingHeads: number | null = null,
  oldEffectsObserved: boolean | null = null) {
  return { barrierReason, requiredTargets, ackedTargets, matchingHeads, oldEffectsObserved };
}
export function summarizeDay97Barrier(input: Day95LifecycleReleaseInput, o?: Day97BarrierObservation) {
  if (!o) return summary("barrier_observation_missing");
  const s = o.scope;
  if (!s || s.deploymentId !== input.scope.deploymentId || s.releaseId !== input.scope.releaseId ||
      s.attemptId !== input.scope.attemptId) return summary("barrier_scope_mismatch");
  const ids = o.expectedResourceIds, rows = o.targets;
  if (!id(o.barrierId) || !Array.isArray(ids) || !ids.length || !ids.every(id) ||
      new Set(ids).size !== ids.length || !Array.isArray(rows) ||
      rows.length !== ids.length || new Set(rows.map(t => t.resourceId)).size !== ids.length ||
      rows.some(t => !ids.includes(t.resourceId))) return summary("barrier_inventory_conflict");
  if (rows.some(t => !Number.isSafeInteger(t.expectedFloor) || t.expectedFloor <= 0 ||
      !sha(t.expectedCommandSha256) || typeof t.ackRecorded !== "boolean" ||
      !Number.isSafeInteger(t.oldEffectCount) || t.oldEffectCount < 0 ||
      (t.head !== null && (!Number.isSafeInteger(t.head.floor) || t.head.floor <= 0 ||
        !sha(t.head.commandSha256) || t.head.deploymentId !== s.deploymentId ||
        t.head.resourceId !== t.resourceId)))) return summary("barrier_observation_invalid");
  const n = rows.length;
  const acked = rows.filter(t => t.ackRecorded).length;
  const matching = rows.filter(t => t.head !== null && t.head.floor === t.expectedFloor &&
    t.head.commandSha256 === t.expectedCommandSha256).length;
  const effects = rows.some(t => t.oldEffectCount > 0);
  return summary(acked !== n ? "fixture_barrier_pending" :
    matching !== n ? "fixture_barrier_head_conflict" :
      "fixture_barrier_all_targets_match_not_authority", n, acked, matching, effects);
}
export async function reviewDay97RemoteRevocationReleaseBoundary(
  input: Day95LifecycleReleaseInput, observed?: Day97BarrierObservation, atomic?: Day96LabObservation
) {
  const prior = await reviewDay96AtomicReleaseBoundary(input, atomic);
  let barrier = summary("barrier_not_evaluated");
  if (input?.intent === "isolated_review") {
    try { barrier = summarizeDay97Barrier(input, observed); }
    catch { barrier = summary("barrier_observation_read_failed"); }
  }
  return { ...prior, ...barrier, barrierObservationTrusted: false as const,
    action: "hold" as const, publishAuthorized: false as const,
    authenticatedEvidenceCount: 0 as const, authenticatedExternalAnchorCount: 0 as const,
    blockers: Array.from(new Set([...prior.blockers, "barrier:" + barrier.barrierReason,
      "remote_revocation_confirmation_unverified",
      ...(barrier.oldEffectsObserved ? ["fixture_old_effect_reconciliation_required"] : []),
      "production_release_not_authorized"])) };
}
