/**
 * Day 87 evening: durable, single-use Ed25519 collector challenges.
 * An ISOLATED control-plane candidate; it cannot grant production release.
 * DB provisioning and issue/revoke methods MUST be restricted to a trusted
 * control plane. Merely possessing this class is NOT a security capability.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  reviewSignedWriterCollectorArtifact,
  type SignedWriterCollectorArtifact
} from "./recovery-writer-collector-attestation.js";

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_BYTES = 8192;
const MAX_TTL_MS = 5 * 60_000;

export interface CollectorChallengeTarget {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly observerId: string;
  readonly hostId: string;
  readonly mountNamespaceId: string;
}
export interface IssueCollectorChallengeInput extends CollectorChallengeTarget {
  readonly keyId: string;
  readonly nowEpochMs: number;
  readonly ttlMs: number;
}
export interface ConsumeCollectorChallengeInput extends CollectorChallengeTarget {
  readonly intent: "isolated_review" | "production_release";
  readonly nowEpochMs: number;
  readonly artifact: SignedWriterCollectorArtifact | null;
}
export type CollectorChallengeConsumeReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_single_use_review";
      artifactSha256: string; publishAuthorized: false }>;
const hold = (reason: string): CollectorChallengeConsumeReview =>
  ({ action: "hold", reason, publishAuthorized: false });
const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const validTarget = (v: CollectorChallengeTarget): boolean =>
  !!v && [v.deploymentId, v.releaseId, v.observerId, v.hostId,
    v.mountNamespaceId].every(validId);
const validTime = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;
const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

type ChallengeRow = {
  deployment_id: string; release_id: string; challenge_id: string;
  observer_id: string; host_id: string; mount_namespace_id: string;
  key_id: string; issued_at_ms: number; expires_at_ms: number;
  state: "issued" | "consumed" | "revoked";
};
type KeyRow = { public_key_pem: string; revoked: number };
const SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_writer_collector_keys (
  deployment_id TEXT NOT NULL, key_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL, public_key_sha256 TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  PRIMARY KEY(deployment_id, key_id)
);
CREATE TABLE IF NOT EXISTS recovery_writer_collector_challenges (
  deployment_id TEXT NOT NULL, release_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  observer_id TEXT NOT NULL, host_id TEXT NOT NULL,
  mount_namespace_id TEXT NOT NULL, key_id TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'issued'
    CHECK(state IN ('issued','consumed','revoked')),
  consumed_artifact_sha256 TEXT,
  PRIMARY KEY(deployment_id, release_id, challenge_id),
  FOREIGN KEY(deployment_id, key_id)
    REFERENCES recovery_writer_collector_keys(deployment_id, key_id)
);`;

export class SQLiteWriterCollectorChallengeStore {
  private readonly db: DatabaseSync;
  constructor(dbPath: string) {
    if (!dbPath?.trim()) throw Error("collector_challenge_db_path_invalid");
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.db.exec(SCHEMA);
  }
  close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* keep original failure */ }
      throw error;
    }
  }

  /**
   * LAB-ONLY trust anchor provisioning. Real keys must come from an
   * independently authenticated control plane; never from a worker request.
   * Existing key IDs cannot be repointed or revived once revoked.
   */
  provisionLabTrustedKey(deploymentId: string, keyId: string, publicKeyPem: string): boolean {
    if (!validId(deploymentId) || !validId(keyId) ||
        typeof publicKeyPem !== "string" ||
        !publicKeyPem.includes("BEGIN PUBLIC KEY") ||
        publicKeyPem.length > 8192) throw Error("collector_key_invalid");
    const digest = sha256(publicKeyPem);
    return this.transaction(() => {
      const inserted = this.db.prepare(
        "INSERT OR IGNORE INTO recovery_writer_collector_keys" +
        "(deployment_id,key_id,public_key_pem,public_key_sha256) VALUES(?,?,?,?)"
      ).run(deploymentId, keyId, publicKeyPem, digest);
      return Number(inserted.changes) === 1;
    });
  }

  /** Revocation and consume acquire the same SQLite writer lock. */
  revokeTrustedKey(deploymentId: string, keyId: string): boolean {
    if (!validId(deploymentId) || !validId(keyId)) throw Error("collector_key_invalid");
    return this.transaction(() => Number(this.db.prepare(
      "UPDATE recovery_writer_collector_keys SET revoked=1 " +
      "WHERE deployment_id=? AND key_id=? AND revoked=0"
    ).run(deploymentId, keyId).changes) === 1);
  }

  /** The trusted controller generates a CSPRNG-backed, release-bound challenge. */
  issueChallenge(input: IssueCollectorChallengeInput): string {
    if (!validTarget(input) || !validId(input.keyId) ||
        !validTime(input.nowEpochMs) ||
        !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 ||
        input.ttlMs > MAX_TTL_MS ||
        !Number.isSafeInteger(input.nowEpochMs + input.ttlMs)) {
      throw Error("challenge_issue_invalid");
    }
    return this.transaction(() => {
      const key = this.db.prepare(
        "SELECT revoked FROM recovery_writer_collector_keys WHERE deployment_id=? AND key_id=?"
      ).get(input.deploymentId, input.keyId) as { revoked: number } | undefined;
      if (!key || key.revoked !== 0) throw Error("collector_key_not_active");
      const id = toHex(randomBytes(24));
      this.db.prepare(
        "INSERT INTO recovery_writer_collector_challenges " +
        "(deployment_id,release_id,challenge_id,observer_id,host_id,mount_namespace_id," +
        "key_id,issued_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?,?,?)"
      ).run(input.deploymentId, input.releaseId, id, input.observerId,
        input.hostId, input.mountNamespaceId, input.keyId,
        input.nowEpochMs, input.nowEpochMs + input.ttlMs);
      return id;
    });
  }

  /**
   * Verify AND consume under BEGIN IMMEDIATE. A successful single-use result
   * consumes the challenge even if a downstream review later returns HOLD.
   * Failed signatures, expired challenges, revoked keys never consume.
   */
  verifyAndConsume(input: ConsumeCollectorChallengeInput): CollectorChallengeConsumeReview {
    if (!input || (input.intent !== "isolated_review" &&
        input.intent !== "production_release")) return hold("intent_invalid");
    if (input.intent === "production_release") return hold("production_release_not_authorized");
    if (!validTarget(input) || !validTime(input.nowEpochMs)) return hold("trusted_context_invalid");
    const artifact = input.artifact;
    if (!artifact || !(artifact.payloadBytes instanceof Uint8Array) ||
        artifact.payloadBytes.length === 0 ||
        artifact.payloadBytes.length > MAX_BYTES) return hold("artifact_invalid");

    let claims: { challengeId?: unknown; observedAtEpochMs?: unknown };
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(artifact.payloadBytes);
      claims = JSON.parse(decoded) as typeof claims;
      if (!claims || typeof claims !== "object" || Array.isArray(claims) ||
          !validId(claims.challengeId)) return hold("challenge_id_invalid");
    } catch { return hold("challenge_id_invalid"); }

    try {
      return this.transaction(() => {
        const row = this.db.prepare(
          "SELECT * FROM recovery_writer_collector_challenges " +
          "WHERE deployment_id=? AND release_id=? AND challenge_id=?"
        ).get(input.deploymentId, input.releaseId, claims.challengeId) as ChallengeRow | undefined;
        if (!row) return hold("challenge_not_issued");
        if (row.state === "consumed") return hold("challenge_replayed");
        if (row.state !== "issued") return hold("challenge_revoked");
        if (input.nowEpochMs < row.issued_at_ms ||
            input.nowEpochMs >= row.expires_at_ms) return hold("challenge_expired_or_clock_invalid");
        if (typeof claims.observedAtEpochMs !== "number" ||
            claims.observedAtEpochMs < row.issued_at_ms ||
            claims.observedAtEpochMs > row.expires_at_ms) return hold("observation_outside_challenge");
        const key = this.db.prepare(
          "SELECT public_key_pem,revoked FROM recovery_writer_collector_keys " +
          "WHERE deployment_id=? AND key_id=?"
        ).get(input.deploymentId, row.key_id) as KeyRow | undefined;
        if (!key || key.revoked !== 0) return hold("collector_key_revoked");
        // The pinned key is loaded from a pre-provisioned trusted store; the
        // request cannot supply a replacement public key or challenge target.
        const signature = reviewSignedWriterCollectorArtifact({
          intent: "isolated_review",
          deploymentId: row.deployment_id, releaseId: row.release_id,
          expectedObserverId: row.observer_id, expectedHostId: row.host_id,
          expectedMountNamespaceId: row.mount_namespace_id,
          expectedChallengeId: row.challenge_id, nowEpochMs: input.nowEpochMs,
          pinnedKeyId: row.key_id,
          pinnedEd25519PublicKeyPem: key.public_key_pem,
          artifact
        });
        if (signature.action === "hold") return hold("signature:" + signature.reason);
        // Require caller's claimed target to be exactly the trusted issued target.
        if (input.observerId !== row.observer_id || input.hostId !== row.host_id ||
            input.mountNamespaceId !== row.mount_namespace_id) {
          return hold("challenge_target_mismatch");
        }
        const changed = this.db.prepare(
          "UPDATE recovery_writer_collector_challenges " +
          "SET state='consumed',consumed_artifact_sha256=? " +
          "WHERE deployment_id=? AND release_id=? AND challenge_id=? AND state='issued'"
        ).run(signature.artifactSha256, row.deployment_id, row.release_id, row.challenge_id);
        if (Number(changed.changes) !== 1) return hold("challenge_consumption_conflict");
        return { action: "ready_for_isolated_single_use_review",
          artifactSha256: signature.artifactSha256, publishAuthorized: false };
      });
    } catch {
      return hold("challenge_store_unavailable");
    }
  }

  /** Read-only test instrumentation, not a security decision input. */
  getChallengeState(deploymentId: string, releaseId: string,
    challengeId: string): string | null {
    const row = this.db.prepare(
      "SELECT state FROM recovery_writer_collector_challenges " +
      "WHERE deployment_id=? AND release_id=? AND challenge_id=?"
    ).get(deploymentId, releaseId, challengeId) as { state: string } | undefined;
    return row?.state ?? null;
  }
}
