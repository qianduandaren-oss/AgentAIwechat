import type { RecoveryWriterTrustWatermark } from "./recovery-writer-trust-watermark-contract.js";

/**
 * Day 84 morning: a PURE comparison contract for a FUTURE same-connection,
 * same-SQLite-transaction writer fence. This function performs no I/O,
 * cannot verify transaction ownership, and is NOT a release gate.
 *
 * Expected watermark must come from trusted cold-start bootstrap, NEVER RPC.
 * Observed watermark must be read through the SAME DatabaseSync connection
 * INSIDE the BEGIN IMMEDIATE transaction that updates Outbox.
 */
const DEPLOYMENT = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;

export class RecoveryWriterTrustFenceConflict extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RecoveryWriterTrustFenceConflict";
  }
}

function valid(w: RecoveryWriterTrustWatermark | null | undefined):
    w is RecoveryWriterTrustWatermark {
  return !!w &&
    typeof w.deploymentId === "string" && DEPLOYMENT.test(w.deploymentId) &&
    Number.isSafeInteger(w.revision) && w.revision >= 1 &&
    typeof w.policySha256 === "string" && SHA256.test(w.policySha256);
}

/**
 * Comparison ONLY. It does not begin a transaction or authorize a write.
 * Invoke from both claim and acknowledge after BEGIN IMMEDIATE, before CAS.
 * The actual integration is a Day 84 noon task.
 */
export function assertRecoveryWriterTrustMatch(
  expected: RecoveryWriterTrustWatermark | null,
  observed: RecoveryWriterTrustWatermark | null
): void {
  if (!valid(expected)) throw new RecoveryWriterTrustFenceConflict("trusted_active_watermark_invalid");
  if (!valid(observed)) throw new RecoveryWriterTrustFenceConflict("transactional_watermark_unavailable");
  if (observed.deploymentId !== expected.deploymentId)
    throw new RecoveryWriterTrustFenceConflict("trust_deployment_mismatch");
  if (observed.revision !== expected.revision)
    throw new RecoveryWriterTrustFenceConflict("stale_trust_revision_fenced");
  if (observed.policySha256.toLowerCase() !== expected.policySha256.toLowerCase())
    throw new RecoveryWriterTrustFenceConflict("trust_policy_digest_mismatch");
}

/** This advisory value must never be interpreted as a publish grant. */
export const RECOVERY_WRITER_TRUST_FENCE_RELEASE = {
  publishAuthorized: false as const,
  nextStep: "same_connection_sqlite_claim_and_ack_integration" as const
};
