/** Day 98 evening: read-only in-flight reconciliation, never provider authority. */
import { reviewDay97RemoteRevocationReleaseBoundary, type Day97BarrierObservation }
  from "./recovery-writer-remote-revocation-release-boundary.js";
import { summarizeDay98InflightInventory, type Day98InflightRow }
  from "./recovery-writer-inflight-effect-reconciliation.js";
import type { Day95LifecycleReleaseInput } from "./recovery-writer-audit-gateway-lifecycle-release-boundary.js";
import type { Day96LabObservation } from "./recovery-writer-atomic-authorization-release-boundary.js";

type Prior = Awaited<ReturnType<typeof reviewDay97RemoteRevocationReleaseBoundary>>;
type Effect = ReturnType<typeof summarizeDay98InflightInventory>["effects"][number];
function report(inflightReason: string, effects: readonly Effect[] = [],
  candidateOldEffectCountMismatch: boolean | null = null) {
  return { inflightReason, effects, candidateOldEffectCountMismatch,
    historicalApplied: effects.filter(e => e.classification === "historical_applied").length,
    finalNotApplied: effects.filter(e => e.classification === "final_not_applied").length,
    unresolved: effects.filter(e => e.classification === "unresolved").length,
    invariantViolations: effects.filter(e => e.classification === "invariant_violation").length,
    appliedObserved: effects.filter(e => e.appliedObserved).length };
}

function summarize(input: Day95LifecycleReleaseInput, prior: Prior,
  barrier?: Day97BarrierObservation, rows?: readonly Day98InflightRow[]) {
  if (!rows || !Array.isArray(rows) || !rows.length) return report("inventory_missing_or_empty");
  if (!barrier || prior.requiredTargets === null) return report("inflight_barrier_unavailable");
  const typed: readonly Day98InflightRow[] = rows;
  const commands = new Set<string>();
  for (const row of typed) {
    const i = row?.intent;
    if (!i) return report("inventory_invalid");
    const target = barrier.targets.find(t => t.resourceId === i.resourceId);
    if (i.deploymentId !== input.scope.deploymentId || i.releaseId !== input.scope.releaseId ||
        i.attemptId !== input.scope.attemptId || i.barrierId !== barrier.barrierId ||
        !target || i.targetFloor !== target.expectedFloor ||
        i.barrierCommandSha256 !== target.expectedCommandSha256)
      return report("inflight_barrier_binding_conflict");
    const commandKey = JSON.stringify([i.providerId,i.commandId]);
    if (commands.has(commandKey)) return report("inventory_identity_conflict");
    commands.add(commandKey);
  }
  const result = summarizeDay98InflightInventory(typed);
  if (result.inventoryReason !== "fixture_inventory_classified_not_authority")
    return report(result.inventoryReason);
  // Counts are only fixture diagnostics, not proof of inventory completeness.
  const mismatch = barrier.targets.some(t => t.oldEffectCount !==
    typed.filter((row,index) => row.intent.resourceId === t.resourceId &&
      result.effects[index].appliedObserved).length);
  return report(result.inventoryReason,result.effects,mismatch);
}

export async function reviewDay98InflightReleaseBoundary(
  input: Day95LifecycleReleaseInput, barrier?: Day97BarrierObservation,
  rows?: readonly Day98InflightRow[], atomic?: Day96LabObservation
) {
  const prior = await reviewDay97RemoteRevocationReleaseBoundary(input,barrier,atomic);
  let reconciliation = report("inflight_not_evaluated");
  if (input?.intent === "isolated_review") {
    try { reconciliation = summarize(input,prior,barrier,rows); }
    catch { reconciliation = report("inflight_observation_read_failed"); }
  }
  return { ...prior,...reconciliation,
    inflightInventoryTrusted: false as const, automaticResend: false as const,
    publishAuthorized: false as const, action: "hold" as const,
    authenticatedEvidenceCount: 0 as const, authenticatedExternalAnchorCount: 0 as const,
    blockers: Array.from(new Set([...prior.blockers,
      "inflight:" + reconciliation.inflightReason, "inflight_inventory_authority_unverified",
      "inflight_provider_receipts_unverified",
      ...(reconciliation.unresolved ? ["fixture_inflight_outcome_unresolved"] : []),
      ...(reconciliation.invariantViolations ? ["fixture_inflight_invariant_violation"] : []),
      ...(reconciliation.candidateOldEffectCountMismatch ? ["fixture_old_effect_count_mismatch"] : []),
      "production_release_not_authorized"])) };
}
