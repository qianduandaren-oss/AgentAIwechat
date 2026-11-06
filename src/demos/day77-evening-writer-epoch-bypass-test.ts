import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteWriterEpochStore, WriterFenceConflict } from "../runtime/recovery-writer-epoch-store.js";

const dir = mkdtempSync(join(tmpdir(), "day77-evening-"));
const path = join(dir, "runtime.db");
const setup = new DatabaseSync(path);
setup.exec("CREATE TABLE effects(id TEXT PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO effects VALUES('e',0)");
const a = new SQLiteWriterEpochStore(path);
const b = new SQLiteWriterEpochStore(path);
const update = (s: SQLiteWriterEpochStore, epoch: number, ownerId: string) =>
 s.guardedUpdate({ scope: "outbox", epoch, ownerId, sql: "UPDATE effects SET value=value+1 WHERE id=?", params:["e"] });
const count = () => (setup.prepare("SELECT value FROM effects WHERE id='e'").get() as {value:number}).value;
try {
 const first = a.rotate("outbox","worker-a");
 assert.equal(update(a,first.epoch,"worker-a"),1);
 const second = b.rotate("outbox","worker-b");
 assert.equal(second.epoch,first.epoch+1);
 assert.throws(()=>update(a,first.epoch,"worker-a"),(e:unknown)=>e instanceof WriterFenceConflict && e.reason==="stale_writer_fenced");
 assert.equal(count(),1);
 a.close();
 const restarted = new SQLiteWriterEpochStore(path);
 try {
  assert.deepEqual(restarted.inspect("outbox"),{epoch:second.epoch,ownerId:"worker-b"});
  assert.throws(()=>update(restarted,first.epoch,"worker-a"),(e:unknown)=>e instanceof WriterFenceConflict);
  assert.equal(update(b,second.epoch,"worker-b"),1);
  const third = restarted.rotate("outbox","worker-c");
  assert.equal(third.epoch,second.epoch+1);
  assert.throws(()=>update(b,second.epoch,"worker-b"),(e:unknown)=>e instanceof WriterFenceConflict);
  assert.equal(update(restarted,third.epoch,"worker-c"),1);
 } finally { restarted.close(); }
 assert.equal(count(),3);
 // Deliberate bypass proof: same SQLite file remains directly writable by legacy code.
 setup.prepare("UPDATE effects SET value=value+1 WHERE id='e'").run();
 assert.equal(count(),4);
 console.log("Day 77 evening: guarded stale writers rejected; unguarded SQL bypass reproduced; NO_GO");
} finally {
 try { a.close(); } catch {}
 b.close(); setup.close(); rmSync(dir,{recursive:true,force:true});
}
