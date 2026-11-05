import type { CutoverEvidenceSource } from "./recovery-dispatcher-cutover-bootstrap.js";
import type { TrustedDispatcherCutoverEvidence } from "./recovery-dispatcher-cutover-policy.js";

/**
 * A bootstrap snapshot is not a continuous write fence. Re-check before every
 * candidate operation; fail closed if the controller becomes unavailable.
 * This still cannot prevent a legacy process with direct DB write privileges.
 */
export class CutoverEvidenceGuard {
  constructor(private readonly source: CutoverEvidenceSource) {}
  async check(): Promise<{ action: "allow_candidate" } | { action: "hold"; reason: string }> {
    try {
      const evidence: TrustedDispatcherCutoverEvidence = await this.source.collect();
      const required: (keyof TrustedDispatcherCutoverEvidence)[] = [
        "legacyDispatcherDisabled", "rawAcknowledgeRestricted",
        "verifiedAdapterConfigured", "durableConsumerDedupeVerified",
        "exclusiveSqliteWriter", "noMixedVersionWorkers"
      ];
      for (const key of required) {
        if (evidence?.[key] !== true) return { action: "hold", reason: key };
      }
      return { action: "allow_candidate" };
    } catch {
      return { action: "hold", reason: "cutover_evidence_unavailable" };
    }
  }
}
