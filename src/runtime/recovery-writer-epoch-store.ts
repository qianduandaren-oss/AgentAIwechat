import { DatabaseSync } from "node:sqlite";

/** Day 77 noon: SQLite-owned epoch authority. Candidate only; no legacy bypass isolation. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS recovery_writer_fence (
 scope TEXT PRIMARY KEY,
 epoch INTEGER NOT NULL CHECK(epoch > 0),
 owner_id TEXT NOT NULL CHECK(length(owner_id) > 0)
);`;
export class WriterFenceConflict extends Error {
 constructor(public readonly reason: string) { super(reason); this.name = "WriterFenceConflict"; }
}
function valid(s: string) { return typeof s === "string" && s.trim().length > 0; }
type FenceRow = { epoch: number; owner_id: string };
export class SQLiteWriterEpochStore {
 private readonly db: DatabaseSync;
 constructor(path: string) {
  this.db = new DatabaseSync(path);
  this.db.exec("PRAGMA busy_timeout=5000;");
  this.db.exec(SCHEMA);
 }
 close() { this.db.close(); }
 inspect(scope: string): { epoch: number; ownerId: string } | undefined {
  const r = this.db.prepare("SELECT epoch,owner_id FROM recovery_writer_fence WHERE scope=?").get(scope) as FenceRow | undefined;
  return r ? { epoch:r.epoch, ownerId:r.owner_id } : undefined;
 }
 /** Trusted coordinator only. This public candidate API is NOT a production authorization boundary. */
 rotate(scope: string, ownerId: string): { epoch:number; ownerId:string } {
  if (!valid(scope) || !valid(ownerId)) throw new WriterFenceConflict("invalid_identity");
  this.db.exec("BEGIN IMMEDIATE");
  try {
   const prev = this.db.prepare("SELECT epoch,owner_id FROM recovery_writer_fence WHERE scope=?").get(scope) as FenceRow | undefined;
   const epoch = (prev?.epoch ?? 0) + 1;
   if (!Number.isSafeInteger(epoch)) throw new WriterFenceConflict("epoch_overflow");
   this.db.prepare("INSERT INTO recovery_writer_fence(scope,epoch,owner_id) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET epoch=excluded.epoch,owner_id=excluded.owner_id").run(scope,epoch,ownerId);
   this.db.exec("COMMIT");
   return {epoch,ownerId};
  } catch(e) { this.db.exec("ROLLBACK"); throw e; }
 }
 /** Check and update in one BEGIN IMMEDIATE. Never use inspect() as write authorization. */
 guardedUpdate(input: {scope:string; epoch:number; ownerId:string; sql:string; params?: (string|number|null)[]}): number {
  if (!valid(input.scope) || !valid(input.ownerId) || !Number.isSafeInteger(input.epoch) || input.epoch < 1)
   throw new WriterFenceConflict("invalid_fence");
  // Only trusted, constant SQL from application code; do not pass request-supplied SQL.
  this.db.exec("BEGIN IMMEDIATE");
  try {
   const row = this.db.prepare("SELECT epoch,owner_id FROM recovery_writer_fence WHERE scope=?").get(input.scope) as FenceRow | undefined;
   if (!row || row.epoch !== input.epoch || row.owner_id !== input.ownerId)
    throw new WriterFenceConflict("stale_writer_fenced");
   const result = this.db.prepare(input.sql).run(...(input.params ?? []));
   this.db.exec("COMMIT");
   return Number(result.changes);
  } catch(e) { this.db.exec("ROLLBACK"); throw e; }
 }
}
