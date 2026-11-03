import { DatabaseSync } from "node:sqlite";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";

/**
 * Day 74 evening: a durable, local consumer-side idempotency candidate.
 * Use a SEPARATE SQLite file from the producer to model the network boundary.
 * The "business effect" is a row in the SAME consumer transaction as the inbox.
 * No HTTP authentication, signature verification, or external side effect is
 * implemented. This class must only be called by a trusted consumer adapter.
 */
const CONSUMER_INBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_consumer_inbox (
  event_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_payload TEXT NOT NULL,
  consumed_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_consumer_business_effects (
  event_id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  effect_payload TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES recovery_consumer_inbox(event_id)
);
`;

type InboxRow = {
  event_id: string; outbox_id: string; command_id: string;
  run_id: string; kind: string; event_payload: string; consumed_at_ms: number;
};
type EffectRow = { event_id: string; command_id: string; run_id: string; effect_payload: string };

export class RecoveryConsumerInboxConflict extends Error {
  constructor(public readonly reason: string) {
    super("Recovery consumer inbox denied: " + reason);
    this.name = "RecoveryConsumerInboxConflict";
  }
}
function deny(reason: string): never { throw new RecoveryConsumerInboxConflict(reason); }
function valid(record: RecoveryOutboxRecord, nowEpochMs: number): boolean {
  return !!record && !!record.id?.trim() && !!record.eventId?.trim() &&
    !!record.commandId?.trim() && !!record.runId?.trim() &&
    !!record.payload?.trim() &&
    (record.kind === "audit" || record.kind === "recovery_event") &&
    (record.status === "pending" || record.status === "dispatched") &&
    Number.isSafeInteger(record.version) && record.version >= 1 &&
    Number.isSafeInteger(record.attempts) && record.attempts >= 1 &&
    Number.isSafeInteger(nowEpochMs) && nowEpochMs >= 0;
}

export type ConsumerInboxResult = {
  action: "applied" | "replayed";
  eventId: string;
  /** Local evidence only. NOT an authenticated network ACK. */
  consumerEvidence: {
    eventId: string; commandId: string; runId: string;
    payload: string; consumedAtEpochMs: number;
  };
};

export class SQLiteRecoveryOutboxConsumerInbox {
  private readonly db: DatabaseSync;
  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.db.exec(CONSUMER_INBOX_SCHEMA);
  }
  close(): void { this.db.close(); }

  inspect(eventId: string): { inbox: InboxRow | undefined; effect: EffectRow | undefined } {
    return {
      inbox: this.db.prepare("SELECT * FROM recovery_consumer_inbox WHERE event_id=?")
        .get(eventId) as InboxRow | undefined,
      effect: this.db.prepare("SELECT * FROM recovery_consumer_business_effects WHERE event_id=?")
        .get(eventId) as EffectRow | undefined
    };
  }

  countApplied(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM recovery_consumer_business_effects")
      .get() as { n: number };
    return row.n;
  }

  consume(record: RecoveryOutboxRecord, input: {
    nowEpochMs: number;
    /** Test-only crash injection; never exposed to an HTTP caller. */
    faultAt?: "after_inbox_insert" | "after_effect_insert";
  }): ConsumerInboxResult {
    if (!valid(record, input.nowEpochMs)) deny("invalid_event_envelope");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const previous = this.db.prepare(
        "SELECT * FROM recovery_consumer_inbox WHERE event_id=?"
      ).get(record.eventId) as InboxRow | undefined;
      if (previous) {
        if (previous.outbox_id !== record.id ||
            previous.command_id !== record.commandId ||
            previous.run_id !== record.runId ||
            previous.kind !== record.kind ||
            previous.event_payload !== record.payload) deny("event_id_rebound");
        const effect = this.db.prepare(
          "SELECT * FROM recovery_consumer_business_effects WHERE event_id=?"
        ).get(record.eventId) as EffectRow | undefined;
        if (!effect || effect.command_id !== record.commandId ||
            effect.run_id !== record.runId ||
            effect.effect_payload !== record.payload) deny("consumer_effect_inconsistent");
        this.db.exec("COMMIT;");
        return {
          action: "replayed", eventId: record.eventId,
          consumerEvidence: {
            eventId: previous.event_id, commandId: previous.command_id,
            runId: previous.run_id, payload: previous.event_payload,
            consumedAtEpochMs: previous.consumed_at_ms
          }
        };
      }
      this.db.prepare(`
        INSERT INTO recovery_consumer_inbox
          (event_id,outbox_id,command_id,run_id,kind,event_payload,consumed_at_ms)
        VALUES (?,?,?,?,?,?,?)
      `).run(record.eventId, record.id, record.commandId, record.runId,
        record.kind, record.payload, input.nowEpochMs);
      if (input.faultAt === "after_inbox_insert") deny("injected_after_inbox_insert");
      this.db.prepare(`
        INSERT INTO recovery_consumer_business_effects
          (event_id,command_id,run_id,effect_payload) VALUES (?,?,?,?)
      `).run(record.eventId, record.commandId, record.runId, record.payload);
      if (input.faultAt === "after_effect_insert") deny("injected_after_effect_insert");
      this.db.exec("COMMIT;");
      return {
        action: "applied", eventId: record.eventId,
        consumerEvidence: {
          eventId: record.eventId, commandId: record.commandId,
          runId: record.runId, payload: record.payload,
          consumedAtEpochMs: input.nowEpochMs
        }
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      if (error instanceof RecoveryConsumerInboxConflict) throw error;
      throw new RecoveryConsumerInboxConflict("consumer_transaction_failed");
    }
  }
}
