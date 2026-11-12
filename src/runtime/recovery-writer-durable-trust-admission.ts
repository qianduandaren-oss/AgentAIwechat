import { createHash } from "node:crypto";
import type {
  AuthenticatedRecoveryWriterPolicySource,
  RecoveryWriterTrustWatermark,
  RecoveryWriterTrustWatermarkStore
} from "./recovery-writer-trust-watermark-contract.js";
import type { bootstrapRecoveredWriterTrust } from "./recovery-writer-durable-trust-bootstrap.js";

/**
 * Day 83 evening: candidate per-request guard for ACTIVE mTLS instances.
 * A persisted CAS alone does not invalidate an old in-memory peer allowlist.
 *
 * Only share a genuinely single, trusted authority store between instances.
 * The authenticated policy source is an interface (laboratory stub today),
 * not a verified production publisher. NO production authorization.
 */
type ReadyBootstrap = Extract<
  Awaited<ReturnType<typeof bootstrapRecoveredWriterTrust>>,
  { action: "ready_for_isolated_bootstrap_test" }
>;
const SHA256 = /^[0-9a-fA-F]{64}$/;

function same(a: RecoveryWriterTrustWatermark | null, b: RecoveryWriterTrustWatermark): boolean {
  return !!a && a.deploymentId === b.deploymentId &&
    Number.isSafeInteger(a.revision) && a.revision === b.revision &&
    typeof a.policySha256 === "string" &&
    a.policySha256.toLowerCase() === b.policySha256.toLowerCase();
}

export class RecoveryWriterDurableTrustAdmissionGate {
  private readonly active: RecoveryWriterTrustWatermark;

  constructor(private readonly input: Readonly<{
    deploymentId: string;
    bootstrap: ReadyBootstrap;
    store: RecoveryWriterTrustWatermarkStore;
    source: AuthenticatedRecoveryWriterPolicySource;
  }>) {
    if (!input || input.bootstrap?.action !== "ready_for_isolated_bootstrap_test" ||
        input.bootstrap.activeWatermark.deploymentId !== input.deploymentId ||
        !SHA256.test(input.bootstrap.activeWatermark.policySha256)) {
      throw new Error("durable_trust_gate_configuration_invalid");
    }
    // Do not retain a mutable source-owned watermark object.
    this.active = Object.freeze({ ...input.bootstrap.activeWatermark });
  }

  /** Fail closed on newer durable revision, source drift, invalid bytes, or source/store outage. */
  async authorize(): Promise<boolean> {
    try {
      const [durable, current] = await Promise.all([
        this.input.store.load(this.input.deploymentId),
        this.input.source.getCurrent(this.input.deploymentId)
      ]);
      if (!same(durable, this.active) || !current ||
          !same(current.watermark, this.active) ||
          !(current.rawPolicyBytes instanceof Uint8Array) ||
          current.rawPolicyBytes.byteLength < 1 ||
          current.rawPolicyBytes.byteLength > 64_000) return false;
      const sha = createHash("sha256").update(current.rawPolicyBytes).digest("hex");
      return sha === this.active.policySha256.toLowerCase();
    } catch {
      return false;
    }
  }
}
