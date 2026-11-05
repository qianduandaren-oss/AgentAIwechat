/** Day 76 morning: pure cutover decision. Not a security boundary or production authorization. */
export interface TrustedDispatcherCutoverEvidence {
  legacyDispatcherDisabled: boolean;
  rawAcknowledgeRestricted: boolean;
  verifiedAdapterConfigured: boolean;
  durableConsumerDedupeVerified: boolean;
  exclusiveSqliteWriter: boolean;
  noMixedVersionWorkers: boolean;
}
export type DispatcherCutoverDecision =
  | { action: "eligible_for_trusted_bootstrap"; publishAuthorized: false }
  | { action: "hold"; reason: keyof TrustedDispatcherCutoverEvidence; publishAuthorized: false };

/** Input MUST be gathered by trusted bootstrap, never directly from a request. */
export function reviewDispatcherCutover(
  evidence: TrustedDispatcherCutoverEvidence
): DispatcherCutoverDecision {
  const required: (keyof TrustedDispatcherCutoverEvidence)[] = [
    "legacyDispatcherDisabled", "rawAcknowledgeRestricted",
    "verifiedAdapterConfigured", "durableConsumerDedupeVerified",
    "exclusiveSqliteWriter", "noMixedVersionWorkers"
  ];
  for (const key of required) {
    if (evidence?.[key] !== true) {
      return { action: "hold", reason: key, publishAuthorized: false };
    }
  }
  return { action: "eligible_for_trusted_bootstrap", publishAuthorized: false };
}
