import { DatabaseSync } from "node:sqlite";
import type {
  RecoveryWriterTrustWatermark,
  RecoveryWriterTrustWatermarkStore
} from "./recovery-writer-trust-watermark-contract.js";

/**
 * Day 83 noon: isolated SAME-SQLite durable policy watermark and transactional CAS.
 * The database must be writable ONLY by the trusted Writer identity. This store
 * does not authenticate policy provenance and is NOT a production rollout system.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_writer_trust_watermarks (
  deployment_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  policy_sha256 TEXT NOT NULL CHECK(length(policy_sha256) = 64)
);`;
const DEPLOYMENT = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;
type Row = { deployment_id: string; revision: number; policy_sha256: string };

function validate(v: RecoveryWriterTrustWatermark): void {
  if (!v || !DEPLOYMENT.test(v.deploymentId) ||
      !Number.isSafeInteger(v.revision) || v.revision < 0 ||
      typeof v.policySha256 !== "string" || !SHA256.test(v.policySha256)) {
    throw new Error("invalid_trust_watermark");
  }
}
function equal(row: Row | undefined, value: RecoveryWriterTrustWatermark): boolean {
  return !!row && row.deployment_id === value.deploymentId &&
    row.revision === value.revision &&
    row.policy_sha256.toLowerCase() === value.policySha256.toLowerCase();
}

export class SQLiteRecoveryWriterTrustWatermarkStore
  implements RecoveryWriterTrustWatermarkStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  /**
   * Lab-only explicit preprovisioning of the trusted anchor.
   * Never call based on an untrusted RPC, arbitrary JSON or missing store row.
   * Production requires externally authenticated, access-controlled provisioning.
   */
  provisionTrustedAnchor(anchor: RecoveryWriterTrustWatermark): boolean {
    validate(anchor);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db.prepare(
        "INSERT OR IGNORE INTO recovery_writer_trust_watermarks(deployment_id,revision,policy_sha256) VALUES(?,?,?)"
      ).run(anchor.deploymentId, anchor.revision, anchor.policySha256.toLowerCase());
      this.db.exec("COMMIT");
      return Number(inserted.changes) === 1;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async load(deploymentId: string): Promise<RecoveryWriterTrustWatermark | null> {
    if (typeof deploymentId !== "string" || !DEPLOYMENT.test(deploymentId)) {
      throw new Error("invalid_trust_deployment");
    }
    const row = this.db.prepare(
      "SELECT deployment_id,revision,policy_sha256 FROM recovery_writer_trust_watermarks WHERE deployment_id=?"
    ).get(deploymentId) as Row | undefined;
    if (!row) return null;
    const result = {
      deploymentId: row.deployment_id, revision: row.revision,
      policySha256: row.policy_sha256
    };
    validate(result);
    return result;
  }

  /** SQLite BEGIN IMMEDIATE serializes competing connections; never read-check-write without it. */
  async compareAndSwap(
    expected: RecoveryWriterTrustWatermark,
    next: RecoveryWriterTrustWatermark
  ): Promise<"advanced" | "conflict"> {
    validate(expected);
    validate(next);
    if (expected.deploymentId !== next.deploymentId ||
        next.revision <= expected.revision) {
      throw new Error("invalid_trust_watermark_transition");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(
        "SELECT deployment_id,revision,policy_sha256 FROM recovery_writer_trust_watermarks WHERE deployment_id=?"
      ).get(expected.deploymentId) as Row | undefined;
      if (!equal(row, expected)) {
        this.db.exec("COMMIT");
        return "conflict";
      }
      const result = this.db.prepare(
        "UPDATE recovery_writer_trust_watermarks SET revision=?,policy_sha256=? WHERE deployment_id=? AND revision=? AND policy_sha256=?"
      ).run(next.revision, next.policySha256.toLowerCase(), expected.deploymentId,
        expected.revision, row!.policy_sha256);
      if (Number(result.changes) !== 1) throw new Error("trust_cas_update_failed");
      this.db.exec("COMMIT");
      return "advanced";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
