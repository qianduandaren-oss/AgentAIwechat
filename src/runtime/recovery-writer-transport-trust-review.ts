/**
 * Day 82 morning — transport trust-root deployment-plan REVIEW ONLY.
 *
 * Boolean fields are untrusted architecture declarations, NOT peer authentication.
 * No socket, mTLS endpoint, certificate verifier or OS permission probe is created.
 * Even a complete plan NEVER authorizes production publish.
 */
export type RecoveryWriterTransportMode = "uds_peercred" | "mtls";

interface CommonTrustPlan {
  readonly deploymentId: string;
  readonly mode: RecoveryWriterTransportMode;
  readonly identityMappingConfigured: boolean;
  readonly perOperationAclSourceConfigured: boolean;
  readonly legacyDbMountRemoved: boolean;
  readonly legacyWritableFdsDrained: boolean;
  readonly consumerAckVerifierConfigured: boolean;
}

export type RecoveryWriterTransportTrustPlan =
  | (CommonTrustPlan & Readonly<{
      mode: "uds_peercred";
      socketDirectoryPrivate: boolean;
      socketPathServerOwned: boolean;
      osPeerCredentialVerifierInstalled: boolean;
    }>)
  | (CommonTrustPlan & Readonly<{
      mode: "mtls";
      clientCertificateRequired: boolean;
      verifiedCertificateChainRequired: boolean;
      certificateIdentityMappingConfigured: boolean;
    }>);

export type RecoveryWriterTransportTrustReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_transport_probe"; publishAuthorized: false }>;

const hold = (reason: string): RecoveryWriterTransportTrustReview =>
  ({ action: "hold", reason, publishAuthorized: false });

const COMMON = [
  "deploymentId", "mode", "identityMappingConfigured",
  "perOperationAclSourceConfigured", "legacyDbMountRemoved",
  "legacyWritableFdsDrained", "consumerAckVerifierConfigured"
] as const;

const PER_MODE = {
  uds_peercred: ["socketDirectoryPrivate", "socketPathServerOwned", "osPeerCredentialVerifierInstalled"],
  mtls: ["clientCertificateRequired", "verifiedCertificateChainRequired", "certificateIdentityMappingConfigured"]
} as const;

/**
 * Review a DECLARED deployment plan. Real peer authentication is intentionally
 * absent; Day 82 noon must bind verified peer identity from the live transport.
 */
export function reviewRecoveryWriterTransportTrustPlan(
  input: unknown
): RecoveryWriterTransportTrustReview {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return hold("transport_plan_missing");
  }
  const plan = input as Record<string, unknown>;
  if (plan.mode !== "uds_peercred" && plan.mode !== "mtls") {
    return hold("transport_mode_unsupported");
  }
  const keys = [...COMMON, ...PER_MODE[plan.mode]];
  if (Object.keys(plan).length !== keys.length ||
      Object.keys(plan).some(key => !keys.includes(key as typeof keys[number]))) {
    return hold("transport_plan_unexpected_or_missing_field");
  }
  if (typeof plan.deploymentId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(plan.deploymentId)) {
    return hold("deployment_not_identified");
  }
  for (const field of keys) {
    if (field === "deploymentId" || field === "mode") continue;
    if (plan[field] !== true) return hold("unverified_deployment_requirement:" + field);
  }
  return { action: "ready_for_isolated_transport_probe", publishAuthorized: false };
}
