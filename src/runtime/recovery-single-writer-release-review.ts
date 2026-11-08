/**
 * Day 79 evening: release-readiness evidence REVIEW only.
 * A list of passing claims is not OS enforcement, a cryptographic attestation,
 * or permission to publish. All production writes remain NO_GO until an
 * independently enforced Single Writer Authority is deployed and verified.
 */
export const SINGLE_WRITER_RELEASE_PROOFS = {
  legacyProcessDbWriteDenied: "os_probe",
  legacyProcessDirectoryWriteDenied: "os_probe",
  legacyDispatcherCannotRestart: "deployment_inspection",
  rawAckIngressBlocked: "integration_test",
  rpcAuthenticationAndAuthorizationVerified: "integration_test",
  realConsumerAckVerificationPassed: "integration_test",
  mixedVersionDbWriteDenied: "os_probe",
  rollbackRetainsDbDeny: "rollback_drill",
  epochLeaseCasCiPassed: "ci_result"
} as const;

export type SingleWriterProofKey = keyof typeof SINGLE_WRITER_RELEASE_PROOFS;
export type SingleWriterProofMethod = typeof SINGLE_WRITER_RELEASE_PROOFS[SingleWriterProofKey];
export interface SingleWriterProof {
  readonly outcome: "pass" | "fail";
  readonly method: SingleWriterProofMethod;
  /** Service/deployment instance this proof describes, not an untrusted client name. */
  readonly deploymentId: string;
  readonly observedAtEpochMs: number;
  readonly attestor: string;
}
export interface SingleWriterReleaseEvidence {
  readonly deploymentId: string;
  readonly proofs: Partial<Record<SingleWriterProofKey, SingleWriterProof>>;
}
export type SingleWriterReleaseReview =
  | { action: "hold"; reason: string; publishAuthorized: false }
  | { action: "ready_for_external_security_review"; publishAuthorized: false };

const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Advisory policy. Proofs must originate from independently trusted deployment
 * probes/CI. The program itself does NOT validate the truth of any proof.
 */
export function reviewSingleWriterReleaseEvidence(
  evidence: SingleWriterReleaseEvidence | null,
  nowEpochMs: number,
  maxAgeMs: number
): SingleWriterReleaseReview {
  const hold = (reason: string): SingleWriterReleaseReview =>
    ({ action: "hold", reason, publishAuthorized: false });

  if (!validTime(nowEpochMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0)
    return hold("review_clock_or_age_invalid");
  if (!evidence?.deploymentId?.trim() || !evidence.proofs || typeof evidence.proofs !== "object")
    return hold("deployment_evidence_unavailable");

  for (const key of Object.keys(SINGLE_WRITER_RELEASE_PROOFS) as SingleWriterProofKey[]) {
    const proof = evidence.proofs[key];
    if (!proof) return hold(`missing_proof:${key}`);
    if (proof.outcome !== "pass") return hold(`failed_proof:${key}`);
    if (proof.method !== SINGLE_WRITER_RELEASE_PROOFS[key])
      return hold(`wrong_method:${key}`);
    if (!proof.attestor?.trim() || proof.deploymentId !== evidence.deploymentId)
      return hold(`unbound_proof:${key}`);
    if (!validTime(proof.observedAtEpochMs) ||
        proof.observedAtEpochMs > nowEpochMs ||
        nowEpochMs - proof.observedAtEpochMs > maxAgeMs)
      return hold(`stale_proof:${key}`);
  }
  // NEVER return GO or publishAuthorized=true on the strength of this policy.
  return { action: "ready_for_external_security_review", publishAuthorized: false };
}
