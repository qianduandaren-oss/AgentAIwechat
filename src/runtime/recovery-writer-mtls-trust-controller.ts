import type { VerifiedTransportCaller } from "./recovery-writer-rpc-contract.js";
import type { MtlsPeerRegistration } from "./recovery-writer-mtls-transport.js";

/**
 * Day 82 evening — server-owned, per-connection mTLS certificate allowlist.
 * This is an IN-MEMORY laboratory policy, NOT a production revocation service.
 * The caller never supplies a snapshot, revision, fingerprint or ACL grant.
 */
export interface RecoveryWriterMtlsTrustSnapshot {
  readonly deploymentId: string;
  readonly revision: number;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly peers: readonly MtlsPeerRegistration[];
}
export type TrustInstallResult =
  | Readonly<{ action: "ready_for_isolated_rotation_test"; revision: number; publishAuthorized: false }>
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>;

const FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const SUBJECT = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_POLICY_AGE_MS = 300_000;
const HOLD = (reason: string): TrustInstallResult => ({
  action: "hold", reason, publishAuthorized: false
});

export class RecoveryWriterMtlsTrustController {
  private revision: number;
  private current: {
    registry: ReadonlyMap<string, VerifiedTransportCaller>;
    expiresAtEpochMs: number;
  } | null = null;
  private lastClock = 0;

  constructor(
    private readonly deploymentId: string,
    private readonly nowEpochMs: () => number,
    /** Must come from a trusted persistent watermark after process restart. */
    minimumRevision = 0
  ) {
    if (!SUBJECT.test(deploymentId) ||
        !Number.isSafeInteger(minimumRevision) || minimumRevision < 0) {
      throw new Error("mtls_trust_controller_configuration_invalid");
    }
    this.revision = minimumRevision;
  }

  private time(): number | null {
    try {
      const now = this.nowEpochMs();
      if (!Number.isSafeInteger(now) || now < 0 || now < this.lastClock) {
        this.current = null;
        return null;
      }
      this.lastClock = now;
      return now;
    } catch {
      this.current = null;
      return null;
    }
  }

  /** Apply only server-trusted snapshots; any malformed update closes admission. */
  install(value: RecoveryWriterMtlsTrustSnapshot): TrustInstallResult {
    this.current = null;
    const now = this.time();
    if (now === null) return HOLD("trusted_clock_unavailable");
    if (!value || value.deploymentId !== this.deploymentId) {
      return HOLD("trust_deployment_mismatch");
    }
    if (!Number.isSafeInteger(value.revision) ||
        value.revision <= this.revision) {
      return HOLD("trust_revision_not_monotonic");
    }
    if (!Number.isSafeInteger(value.issuedAtEpochMs) ||
        !Number.isSafeInteger(value.expiresAtEpochMs) ||
        value.issuedAtEpochMs > now ||
        now >= value.expiresAtEpochMs ||
        value.expiresAtEpochMs - value.issuedAtEpochMs > MAX_POLICY_AGE_MS) {
      return HOLD("trust_policy_expired_or_invalid");
    }
    if (!Array.isArray(value.peers) || value.peers.length < 1 ||
        value.peers.length > 128) {
      return HOLD("trust_peer_registry_invalid");
    }
    const registry = new Map<string, VerifiedTransportCaller>();
    for (const peer of value.peers) {
      if (!peer || typeof peer.fingerprint256 !== "string" ||
          !FINGERPRINT.test(peer.fingerprint256.toUpperCase()) ||
          !SUBJECT.test(peer.subject) ||
          !Array.isArray(peer.grantedOperations) ||
          peer.grantedOperations.length < 1 || peer.grantedOperations.length > 2 ||
          peer.grantedOperations.some(op => op !== "claim_outbox" && op !== "confirm_outbox") ||
          new Set(peer.grantedOperations).size !== peer.grantedOperations.length) {
        return HOLD("trust_peer_registration_invalid");
      }
      const key = peer.fingerprint256.toUpperCase();
      if (registry.has(key)) return HOLD("trust_duplicate_certificate");
      registry.set(key, Object.freeze({
        subject: peer.subject,
        mechanism: "mutual_tls" as const,
        grantedOperations: Object.freeze([...peer.grantedOperations])
      }));
    }
    this.revision = value.revision;
    this.current = { registry, expiresAtEpochMs: value.expiresAtEpochMs };
    return {
      action: "ready_for_isolated_rotation_test",
      revision: this.revision,
      publishAuthorized: false
    };
  }

  /** Returns null when unregistered, expired, clock fails or update was rejected. */
  resolve(fingerprint256: string): VerifiedTransportCaller | null {
    const now = this.time();
    if (now === null || !this.current || now >= this.current.expiresAtEpochMs) {
      this.current = null;
      return null;
    }
    return typeof fingerprint256 === "string"
      ? (this.current.registry.get(fingerprint256.toUpperCase()) ?? null)
      : null;
  }
}
