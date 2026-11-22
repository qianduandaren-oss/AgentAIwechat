/**
 * Day 93 noon: isolated durable checkpoint experiment, NOT an authenticated
 * external audit service. Even a separate SQLite file can be rewritten by a
 * caller sharing its OS identity, and SQL triggers are bypassable by DB owners.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";
import {
  DAY93_AUDIT_ANCHOR_DOMAIN,
  type Day93AuditAnchorCandidate,
  type Day93AuditAnchorReader
} from "./recovery-writer-inventory-audit-anchor.js";

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const digest = (s: string): string =>
  createHash("sha256").update(new TextEncoder().encode(s)).digest("hex");

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS recovery_writer_audit_events (",
  " deployment_id TEXT NOT NULL, release_id TEXT NOT NULL,",
  " attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>=1),",
  " payload_json TEXT NOT NULL, previous_event_sha256 TEXT NOT NULL,",
  " event_sha256 TEXT NOT NULL,",
  " PRIMARY KEY(deployment_id,release_id,attempt_id,sequence)",
  ");",
  "CREATE TRIGGER IF NOT EXISTS recovery_writer_audit_no_update",
  " BEFORE UPDATE ON recovery_writer_audit_events BEGIN",
  " SELECT RAISE(ABORT,'append_only_update_forbidden'); END;",
  "CREATE TRIGGER IF NOT EXISTS recovery_writer_audit_no_delete",
  " BEFORE DELETE ON recovery_writer_audit_events BEGIN",
  " SELECT RAISE(ABORT,'append_only_delete_forbidden'); END;"
].join("\n");

type AuditRow = {
  deployment_id: string;
  release_id: string;
  attempt_id: string;
  sequence: number;
  payload_json: string;
  previous_event_sha256: string;
  event_sha256: string;
};

export interface Day93AuditHead {
  readonly candidate: Day93AuditAnchorCandidate;
  readonly eventSha256: string;
  readonly previousEventSha256: string;
}

export interface Day93AuditExpectedHead {
  readonly checkpointSequence: number;
  readonly eventSha256: string | null;
}

export type Day93AuditAppendResult =
  | { readonly status: "appended" | "exact_replay"; readonly head: Day93AuditHead }
  | { readonly status: "cas_conflict" | "transition_rejected" };

const bindingValid = (b: Day91InventoryBinding): boolean =>
  !!b && [b.deploymentId, b.releaseId, b.attemptId]
    .every(v => typeof v === "string" && ID.test(v));

function normalized(c: Day93AuditAnchorCandidate): Day93AuditAnchorCandidate {
  return {
    domain: c.domain,
    deploymentId: c.deploymentId, releaseId: c.releaseId, attemptId: c.attemptId,
    snapshotId: c.snapshotId, revision: c.revision,
    manifestSha256: c.manifestSha256, freezeVersion: c.freezeVersion,
    state: c.state, checkpointSequence: c.checkpointSequence,
    recordedAtEpochMs: c.recordedAtEpochMs, expiresAtEpochMs: c.expiresAtEpochMs
  };
}
const candidateValid = (c: Day93AuditAnchorCandidate): boolean =>
  !!c && c.domain === DAY93_AUDIT_ANCHOR_DOMAIN &&
  bindingValid(c) && ID.test(c.snapshotId) && ID.test(c.revision) &&
  SHA.test(c.manifestSha256) &&
  (c.state === "frozen" || c.state === "invalidated") &&
  Number.isSafeInteger(c.freezeVersion) && c.freezeVersion >= 1 &&
  Number.isSafeInteger(c.checkpointSequence) &&
  c.checkpointSequence === c.freezeVersion &&
  Number.isSafeInteger(c.recordedAtEpochMs) && c.recordedAtEpochMs >= 0 &&
  Number.isSafeInteger(c.expiresAtEpochMs) &&
  c.expiresAtEpochMs > c.recordedAtEpochMs;

const seal = (payloadJson: string, previous: string): string =>
  digest(JSON.stringify({
    domain: "agent-ai/recovery/audit-event/v1",
    previousEventSha256: previous,
    payloadJson
  }));

/** Separate-file SQLite is ONLY a fixture-level failure and concurrency lab. */
export class SQLiteDay93AuditCheckpointStore implements Day93AuditAnchorReader {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path || !path.trim()) throw Error("audit_checkpoint_path_invalid");
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=250;");
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve first error */ }
      throw err;
    }
  }

  private chain(binding: Day91InventoryBinding): Day93AuditHead[] {
    const rows = this.db.prepare(
      "SELECT * FROM recovery_writer_audit_events WHERE " +
      "deployment_id=? AND release_id=? AND attempt_id=? ORDER BY sequence"
    ).all(binding.deploymentId, binding.releaseId, binding.attemptId) as AuditRow[];
    const heads: Day93AuditHead[] = [];
    let previous = "0".repeat(64);
    for (const row of rows) {
      let candidate: Day93AuditAnchorCandidate;
      try { candidate = JSON.parse(row.payload_json) as Day93AuditAnchorCandidate; }
      catch { throw Error("audit_checkpoint_chain_corrupt"); }
      const head = heads[heads.length - 1];
      const isGenesis = !head && row.sequence === 1 &&
        candidate.state === "frozen" && candidate.freezeVersion === 1;
      const isInvalidate = !!head && head.candidate.state === "frozen" &&
        candidate.state === "invalidated" &&
        candidate.freezeVersion === head.candidate.freezeVersion + 1 &&
        candidate.checkpointSequence === head.candidate.checkpointSequence + 1 &&
        candidate.snapshotId === head.candidate.snapshotId &&
        candidate.revision === head.candidate.revision &&
        candidate.manifestSha256 === head.candidate.manifestSha256 &&
        candidate.recordedAtEpochMs > head.candidate.recordedAtEpochMs;
      if (!candidateValid(candidate) ||
          JSON.stringify(normalized(candidate)) !== row.payload_json ||
          candidate.deploymentId !== binding.deploymentId ||
          candidate.releaseId !== binding.releaseId ||
          candidate.attemptId !== binding.attemptId ||
          row.sequence !== candidate.checkpointSequence ||
          row.previous_event_sha256 !== previous ||
          row.event_sha256 !== seal(row.payload_json, previous) ||
          (!isGenesis && !isInvalidate)) {
        throw Error("audit_checkpoint_chain_corrupt");
      }
      heads.push({
        candidate, eventSha256: row.event_sha256,
        previousEventSha256: row.previous_event_sha256
      });
      previous = row.event_sha256;
    }
    return heads;
  }

  readHead(binding: Day91InventoryBinding): Day93AuditHead | null {
    if (!bindingValid(binding)) throw Error("audit_checkpoint_binding_invalid");
    this.db.exec("BEGIN");
    try {
      const history = this.chain(binding);
      this.db.exec("COMMIT");
      return history[history.length - 1] ?? null;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve first error */ }
      throw err;
    }
  }

  async readAnchor(binding: Day91InventoryBinding): Promise<Day93AuditAnchorCandidate | null> {
    return this.readHead(binding)?.candidate ?? null;
  }

  appendOnce(
    candidate: Day93AuditAnchorCandidate,
    expected: Day93AuditExpectedHead
  ): Day93AuditAppendResult {
    if (!candidateValid(candidate) ||
        !Number.isSafeInteger(expected?.checkpointSequence) ||
        expected.checkpointSequence < 0 ||
        (expected.eventSha256 !== null && !SHA.test(expected.eventSha256))) {
      throw Error("audit_checkpoint_append_input_invalid");
    }
    return this.transaction(() => {
      const history = this.chain(candidate);
      const head = history[history.length - 1];
      const currentSeq = head?.candidate.checkpointSequence ?? 0;
      const currentHash = head?.eventSha256 ?? null;
      const payloadJson = JSON.stringify(normalized(candidate));
      // A retry is idempotent only if it quotes the precise predecessor.
      if (head && candidate.checkpointSequence === currentSeq &&
          JSON.stringify(head.candidate) === payloadJson &&
          expected.checkpointSequence === currentSeq - 1 &&
          expected.eventSha256 === (currentSeq === 1 ? null : head.previousEventSha256)) {
        return { status: "exact_replay", head };
      }
      if (expected.checkpointSequence !== currentSeq ||
          expected.eventSha256 !== currentHash) return { status: "cas_conflict" };
      const genesis = !head && candidate.checkpointSequence === 1 &&
        candidate.freezeVersion === 1 && candidate.state === "frozen";
      const invalidate = !!head && head.candidate.state === "frozen" &&
        candidate.state === "invalidated" &&
        candidate.checkpointSequence === currentSeq + 1 &&
        candidate.freezeVersion === head.candidate.freezeVersion + 1 &&
        candidate.snapshotId === head.candidate.snapshotId &&
        candidate.revision === head.candidate.revision &&
        candidate.manifestSha256 === head.candidate.manifestSha256 &&
        candidate.recordedAtEpochMs > head.candidate.recordedAtEpochMs;
      if (!genesis && !invalidate) return { status: "transition_rejected" };
      const previousHash = currentHash ?? "0".repeat(64);
      const eventHash = seal(payloadJson, previousHash);
      this.db.prepare(
        "INSERT INTO recovery_writer_audit_events " +
        "(deployment_id,release_id,attempt_id,sequence,payload_json," +
        "previous_event_sha256,event_sha256) VALUES(?,?,?,?,?,?,?)"
      ).run(candidate.deploymentId, candidate.releaseId, candidate.attemptId,
        candidate.checkpointSequence, payloadJson, previousHash, eventHash);
      return {
        status: "appended",
        head: { candidate: normalized(candidate),
          eventSha256: eventHash, previousEventSha256: previousHash }
      };
    });
  }
}
