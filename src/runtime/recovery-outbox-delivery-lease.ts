import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { planRecoveryOutboxDelivery, type RecoveryOutboxConsumerContract } from "./recovery-outbox-delivery-contract.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "./sqlite-recovery-finalization.js";

/**
 * Day 74 noon: durable claim/lease for the SAME recovery_outbox table written
 * by Day 73 Finalizer. This is a candidate SQLite delivery coordinator, not a
 * network publisher, production authorization boundary, or consumer dedupe.
 * Consumer contracts and authenticated ACKs MUST be established by a trusted
 * server adapter; callers must not pass untrusted JSON as those authorities.
 */
const DELIVERY_LEASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_outbox_delivery_leases (
  outbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  lease_token TEXT NOT NULL UNIQUE,
  lease_expires_ms INTEGER NOT NULL,
  attempt INTEGER NOT NULL
);`;

type OutboxRow = {
  id: string; event_id: string; command_id: string; run_id: string; payload: string;
};
type LeaseRow = {
  outbox_id: string; event_id: string; worker_id: string;
  lease_token: string; lease_expires_ms: number; attempt: number;
};

export type RecoveryDeliveryClaimResult =
  | { action: "claimed"; record: RecoveryOutboxRecord; leaseToken: string;
      leaseExpiresAtEpochMs: number; consumerIdempotencyKey: string }
  | { action: "busy"; eventId: string; leaseExpiresAtEpochMs: number }
  | { action: "already_dispatched"; eventId: string }
  | { action: "hold"; reason: string };

export type RecoveryDeliveryAckResult =
  | { action: "dispatched"; eventId: string; version: number }
  | { action: "already_dispatched"; eventId: string; version: number };

export class RecoveryDeliveryConflict extends Error {
  constructor(public readonly reason: string) {
    super("Recovery delivery denied: " + reason);
    this.name = "RecoveryDeliveryConflict";
  }
}
function deny(reason: string): never { throw new RecoveryDeliveryConflict(reason); }
function validTime(n: number): boolean { return Number.isSafeInteger(n) && n >= 0; }

export class SQLiteRecoveryOutboxDeliveryClaimer {
  private readonly db: DatabaseSync;
  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(RECOVERY_FINALIZATION_SCHEMA);
    this.db.exec(DELIVERY_LEASE_SCHEMA);
  }
  close(): void { this.db.close(); }

  inspect(outboxId: string): RecoveryOutboxRecord | undefined {
    const row = this.db.prepare("SELECT * FROM recovery_outbox WHERE id=?")
      .get(outboxId) as OutboxRow | undefined;
    if (!row) return undefined;
    return this.decode(row);
  }

  private decode(row: OutboxRow): RecoveryOutboxRecord {
    let record: RecoveryOutboxRecord;
    try { record = JSON.parse(row.payload) as RecoveryOutboxRecord; }
    catch { return deny("outbox_payload_invalid"); }
    if (record.id !== row.id || record.eventId !== row.event_id ||
        record.commandId !== row.command_id || record.runId !== row.run_id) {
      deny("outbox_identity_mismatch");
    }
    return record;
  }

  claim(input: {
    outboxId: string; workerId: string; consumer: RecoveryOutboxConsumerContract;
    nowEpochMs: number; leaseMs: number;
  }): RecoveryDeliveryClaimResult {
    if (!input.outboxId?.trim() || !input.workerId?.trim() ||
        !validTime(input.nowEpochMs) || !Number.isSafeInteger(input.leaseMs) ||
        input.leaseMs <= 0 || !Number.isSafeInteger(input.nowEpochMs + input.leaseMs)) {
      return { action: "hold", reason: "invalid_claim_input" };
    }
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.db.prepare("SELECT * FROM recovery_outbox WHERE id=?")
        .get(input.outboxId) as OutboxRow | undefined;
      if (!row) {
        this.db.exec("COMMIT;");
        return { action: "hold", reason: "outbox_missing" };
      }
      const record = this.decode(row);
      const plan = planRecoveryOutboxDelivery(record, input.consumer);
      if (plan.action === "hold") {
        this.db.exec("COMMIT;");
        return { action: "hold", reason: plan.reason };
      }
      if (plan.action === "already_dispatched") {
        this.db.exec("COMMIT;");
        return { action: "already_dispatched", eventId: record.eventId };
      }
      const previous = this.db.prepare(
        "SELECT * FROM recovery_outbox_delivery_leases WHERE outbox_id=?"
      ).get(record.id) as LeaseRow | undefined;
      if (previous && previous.event_id !== record.eventId) deny("lease_identity_mismatch");
      if (previous && previous.lease_expires_ms > input.nowEpochMs) {
        this.db.exec("COMMIT;");
        return { action: "busy", eventId: record.eventId,
          leaseExpiresAtEpochMs: previous.lease_expires_ms };
      }
      const leaseToken = randomUUID();
      const expires = input.nowEpochMs + input.leaseMs;
      const next: RecoveryOutboxRecord = {
        ...record, attempts: record.attempts + 1, version: record.version + 1,
        updatedAt: new Date(input.nowEpochMs).toISOString()
      };
      const updated = this.db.prepare(`
        UPDATE recovery_outbox SET payload=? WHERE id=? AND event_id=?
          AND json_extract(payload,'$.version')=?
          AND json_extract(payload,'$.status')='pending'
      `).run(JSON.stringify(next), record.id, record.eventId, record.version);
      if (updated.changes !== 1) deny("outbox_cas_conflict");
      this.db.prepare(`
        INSERT INTO recovery_outbox_delivery_leases
          (outbox_id,event_id,worker_id,lease_token,lease_expires_ms,attempt)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(outbox_id) DO UPDATE SET
          event_id=excluded.event_id, worker_id=excluded.worker_id,
          lease_token=excluded.lease_token,
          lease_expires_ms=excluded.lease_expires_ms, attempt=excluded.attempt
      `).run(record.id, record.eventId, input.workerId, leaseToken, expires, next.attempts);
      this.db.exec("COMMIT;");
      return { action: "claimed", record: next, leaseToken,
        leaseExpiresAtEpochMs: expires, consumerIdempotencyKey: record.eventId };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      if (error instanceof RecoveryDeliveryConflict) throw error;
      throw new RecoveryDeliveryConflict("claim_transaction_failed");
    }
  }

  acknowledge(input: {
    outboxId: string; eventId: string; leaseToken: string;
    source: "authenticated_consumer_adapter"; nowEpochMs: number;
  }): RecoveryDeliveryAckResult {
    if (!input.outboxId?.trim() || !input.eventId?.trim() ||
        !input.leaseToken?.trim() || input.source !== "authenticated_consumer_adapter" ||
        !validTime(input.nowEpochMs)) deny("ack_untrusted_or_invalid");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.db.prepare("SELECT * FROM recovery_outbox WHERE id=?")
        .get(input.outboxId) as OutboxRow | undefined;
      const lease = this.db.prepare(
        "SELECT * FROM recovery_outbox_delivery_leases WHERE outbox_id=?"
      ).get(input.outboxId) as LeaseRow | undefined;
      if (!row || !lease || row.event_id !== input.eventId ||
          lease.event_id !== input.eventId ||
          lease.lease_token !== input.leaseToken) deny("ack_binding_mismatch");
      const record = this.decode(row);
      if (record.status === "dispatched") {
        this.db.exec("COMMIT;");
        return { action: "already_dispatched", eventId: record.eventId, version: record.version };
      }
      if (record.status !== "pending" || input.nowEpochMs >= lease.lease_expires_ms ||
          lease.attempt !== record.attempts) deny("ack_stale_lease");
      const timestamp = new Date(input.nowEpochMs).toISOString();
      const next: RecoveryOutboxRecord = {
        ...record, status: "dispatched", version: record.version + 1,
        updatedAt: timestamp, dispatchedAt: timestamp
      };
      const changed = this.db.prepare(`
        UPDATE recovery_outbox SET payload=? WHERE id=? AND event_id=?
          AND json_extract(payload,'$.version')=?
          AND json_extract(payload,'$.status')='pending'
      `).run(JSON.stringify(next), record.id, record.eventId, record.version);
      if (changed.changes !== 1) deny("ack_outbox_cas_conflict");
      this.db.exec("COMMIT;");
      return { action: "dispatched", eventId: record.eventId, version: next.version };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      if (error instanceof RecoveryDeliveryConflict) throw error;
      throw new RecoveryDeliveryConflict("ack_transaction_failed");
    }
  }
}
