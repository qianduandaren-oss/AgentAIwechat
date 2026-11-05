import { reviewDispatcherCutover, type TrustedDispatcherCutoverEvidence } from "./recovery-dispatcher-cutover-policy.js";
import { RecoveryVerifiedDeliveryGateway } from "./recovery-verified-delivery-gateway.js";

/**
 * A trusted deployment controller must collect these facts. A request body or
 * environment flag alone is not proof that old workers lost write access.
 */
export interface CutoverEvidenceSource {
  collect(): Promise<TrustedDispatcherCutoverEvidence>;
}

export type CutoverBootstrapResult =
  | { action: "hold"; reason: string; gateway?: never }
  | { action: "ready_for_candidate_tests"; gateway: RecoveryVerifiedDeliveryGateway };

/**
 * Fail closed: no gateway is returned until ALL six independently gathered
 * conditions pass. This does NOT grant production publish authorization.
 */
export async function bootstrapRecoveryDelivery(
  source: CutoverEvidenceSource,
  gateway: RecoveryVerifiedDeliveryGateway
): Promise<CutoverBootstrapResult> {
  try {
    const evidence = await source.collect();
    const decision = reviewDispatcherCutover(evidence);
    if (decision.action === "hold") {
      return { action: "hold", reason: decision.reason };
    }
    return { action: "ready_for_candidate_tests", gateway };
  } catch {
    return { action: "hold", reason: "cutover_evidence_unavailable" };
  }
}
