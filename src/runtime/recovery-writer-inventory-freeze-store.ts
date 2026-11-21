/**
 * Day 92 noon: durable SQLite inventory freeze / invalidate for ISOLATED LABS.
 * This file does NOT authenticate its injected source, protect the DB from
 * old write-capable processes, or authorize a production release.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalDay92InventoryManifestBytes,
  planDay92InventoryFreezeCandidate
} from "./recovery-writer-inventory-freeze-candidate.js";
import type {
  Day91InventoryAnchor,
  Day91InventoryBinding,
  Day91InventorySnapshot
} from "./recovery-writer-cutover-inventory-adapter.js";
import type {
  WriterCutoverEvidenceScope
} from "./recovery-writer-cutover-evidence-coverage.js";

const VALID_ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const VALID_SHA = /^[a-f0-9]{64}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_writer_inventory_freezes (
  deployment_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  captured_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('frozen','invalidated')),
  version INTEGER NOT NULL CHECK(version >= 1),
  PRIMARY KEY (deployment_id, release_id, attempt_id)
);`;

export interface Day92StoredInventoryFreeze extends Day91InventoryBinding {
  readonly snapshotId: string;
  readonly revision: string;
  readonly capturedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly manifestSha256: string;
  readonly manifestJson: string;
  readonly state: "frozen" | "invalidated";
  readonly version: number;
}

type FreezeRow = {
  deployment_id: string; release_id: string; attempt_id: string;
  snapshot_id: string; revision: string; captured_at_ms: number;
  expires_at_ms: number; manifest_sha256: string; manifest_json: string;
  state: "frozen" | "invalidated"; version: number;
};
const SHA = (value: string): string =>
  createHash("sha256").update(new TextEncoder().encode(value)).digest("hex");

const bindingValid = (binding: Day91InventoryBinding): boolean =>
  !!binding && [binding.deploymentId, binding.releaseId, binding.attemptId]
    .every(value => typeof value === "string" && VALID_ID.test(value));

function fromRow(row: FreezeRow | undefined): Day92StoredInventoryFreeze | null {
  if (!row) return null;
  if (!VALID_SHA.test(row.manifest_sha256) ||
      SHA(row.manifest_json) !== row.manifest_sha256) {
    throw Error("inventory_freeze_db_integrity_mismatch");
  }
  return {
    deploymentId: row.deployment_id, releaseId: row.release_id,
    attemptId: row.attempt_id, snapshotId: row.snapshot_id,
    revision: row.revision, capturedAtEpochMs: row.captured_at_ms,
    expiresAtEpochMs: row.expires_at_ms, manifestSha256: row.manifest_sha256,
    manifestJson: row.manifest_json, state: row.state, version: row.version
  };
}

export type Day92FreezeWriteResult =
  | { readonly status: "frozen" | "exact_replay"; readonly record: Day92StoredInventoryFreeze }
  | { readonly status: "conflict" | "invalidated" };

export class SQLiteDay92InventoryFreezeStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path || !path.trim()) throw Error("inventory_freeze_path_invalid");
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private readRow(binding: Day91InventoryBinding): FreezeRow | undefined {
    return this.db.prepare(
      "SELECT * FROM recovery_writer_inventory_freezes " +
      "WHERE deployment_id=? AND release_id=? AND attempt_id=?"
    ).get(binding.deploymentId, binding.releaseId, binding.attemptId) as
      FreezeRow | undefined;
  }

  load(binding: Day91InventoryBinding): Day92StoredInventoryFreeze | null {
    if (!bindingValid(binding)) throw Error("inventory_freeze_binding_invalid");
    return fromRow(this.readRow(binding));
  }

  /**
   * INSERT-once is the linearization point. Exact replay is harmless;
   * any changed bytes/revision for the same attempt are rejected forever.
   * This is CAS-like immutable insert + SQLite lock, NOT proof of authority.
   */
  freezeOnce(snapshot: Day91InventorySnapshot, expectedSha256: string): Day92FreezeWriteResult {
    if (!bindingValid(snapshot) || !VALID_ID.test(snapshot.snapshotId) ||
        !VALID_ID.test(snapshot.revision) || !VALID_SHA.test(expectedSha256)) {
      throw Error("inventory_freeze_input_invalid");
    }
    const manifestJson = new TextDecoder().decode(
      canonicalDay92InventoryManifestBytes(snapshot)
    );
    if (SHA(manifestJson) !== expectedSha256) {
      throw Error("inventory_freeze_manifest_digest_mismatch");
    }
    return this.transaction(() => {
      const existing = fromRow(this.readRow(snapshot));
      if (existing) {
        if (existing.state !== "frozen") return { status: "invalidated" };
        if (existing.snapshotId === snapshot.snapshotId &&
            existing.revision === snapshot.revision &&
            existing.manifestSha256 === expectedSha256 &&
            existing.manifestJson === manifestJson) {
          return { status: "exact_replay", record: existing };
        }
        return { status: "conflict" };
      }
      this.db.prepare(
        "INSERT INTO recovery_writer_inventory_freezes " +
        "(deployment_id,release_id,attempt_id,snapshot_id,revision," +
        "captured_at_ms,expires_at_ms,manifest_sha256,manifest_json,state,version) " +
        "VALUES(?,?,?,?,?,?,?,?,?,'frozen',1)"
      ).run(snapshot.deploymentId, snapshot.releaseId, snapshot.attemptId,
        snapshot.snapshotId, snapshot.revision, snapshot.capturedAtEpochMs,
        snapshot.expiresAtEpochMs, expectedSha256, manifestJson);
      const record = fromRow(this.readRow(snapshot));
      if (!record) throw Error("inventory_freeze_insert_missing");
      return { status: "frozen", record };
    });
  }

  /** Lab-only invalidation: a changed deployment must start a NEW attempt. */
  invalidate(
    binding: Day91InventoryBinding,
    expected: { readonly version: number; readonly manifestSha256: string }
  ): "invalidated" | "already_invalidated" | "conflict" | "missing" {
    if (!bindingValid(binding) || !Number.isSafeInteger(expected?.version) ||
        expected.version < 1 || !VALID_SHA.test(expected?.manifestSha256)) {
      throw Error("inventory_invalidation_input_invalid");
    }
    return this.transaction(() => {
      const row = fromRow(this.readRow(binding));
      if (!row) return "missing";
      if (row.version !== expected.version ||
          row.manifestSha256 !== expected.manifestSha256) return "conflict";
      if (row.state === "invalidated") return "already_invalidated";
      const changed = this.db.prepare(
        "UPDATE recovery_writer_inventory_freezes " +
        "SET state='invalidated',version=version+1 " +
        "WHERE deployment_id=? AND release_id=? AND attempt_id=? " +
        "AND version=? AND manifest_sha256=? AND state='frozen'"
      ).run(binding.deploymentId, binding.releaseId, binding.attemptId,
        row.version, row.manifestSha256);
      if (Number(changed.changes) !== 1) throw Error("inventory_invalidation_cas_failed");
      return "invalidated";
    });
  }
}

/**
 * Inject ONLY from a controller-side composition root in the isolated test.
 * The interface name intentionally does not claim authentication.
 */
export interface Day92IsolatedInventorySource {
  readSnapshot(binding: Day91InventoryBinding): Promise<Day91InventorySnapshot | null>;
}

export interface Day92IsolatedFreezeConfig {
  readonly scope: WriterCutoverEvidenceScope;
  readonly expectedAnchor: Day91InventoryAnchor;
  readonly source: Day92IsolatedInventorySource;
  readonly store: SQLiteDay92InventoryFreezeStore;
}

export interface Day92IsolatedFreezeReview {
  readonly action: "hold";
  readonly reason: string;
  readonly persisted: boolean;
  readonly manifestSha256: string | null;
  readonly authenticatedInventoryCount: 0;
  readonly publishAuthorized: false;
}

export class Day92IsolatedInventoryFreezeService {
  constructor(private readonly config: Day92IsolatedFreezeConfig) {}

  async reviewAndFreeze(input: {
    readonly intent: "isolated_review" | "production_release";
    readonly nowEpochMs: number;
  }): Promise<Day92IsolatedFreezeReview> {
    const hold = (reason: string, persisted = false,
      manifestSha256: string | null = null): Day92IsolatedFreezeReview => ({
        action: "hold", reason, persisted, manifestSha256,
        authenticatedInventoryCount: 0, publishAuthorized: false
      });
    if (input?.intent !== "isolated_review") return hold("production_release_not_authorized");
    let snapshot: Day91InventorySnapshot | null;
    try {
      const scope = this.config.scope;
      snapshot = await this.config.source.readSnapshot({
        deploymentId: scope.deploymentId, releaseId: scope.releaseId,
        attemptId: scope.attemptId
      });
    } catch {
      return hold("inventory_source_unavailable");
    }
    const candidate = await planDay92InventoryFreezeCandidate({
      intent: "isolated_review", scope: this.config.scope,
      expectedAnchor: this.config.expectedAnchor,
      snapshot, nowEpochMs: input.nowEpochMs
    });
    if (!candidate.candidate) return hold(candidate.reason);
    try {
      const write = this.config.store.freezeOnce(snapshot!, candidate.candidate.manifestSha256);
      if (!("record" in write)) {
        return hold(write.status === "conflict"
          ? "same_attempt_manifest_conflict"
          : "attempt_invalidated_new_attempt_required");
      }
      return hold(write.status === "frozen"
        ? "durable_fixture_frozen_source_unverified"
        : "durable_fixture_exact_replay_source_unverified",
        true, write.record.manifestSha256);
    } catch {
      return hold("inventory_freeze_store_unavailable");
    }
  }
}
