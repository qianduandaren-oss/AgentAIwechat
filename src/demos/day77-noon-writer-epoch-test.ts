import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteWriterEpochStore, WriterFenceConflict } from "../runtime/recovery-writer-epoch-store.js";
const dir = mkdtempSync(join(tmpdir(),"day77-fence-"));
const path = join(dir,"fence.db");
const admin = new DatabaseSync(path);
admin.exec("CREATE TABLE effects(id TEXT PRIMARY KEY, value INTEGER NOT NULL)");
admin.prepare("INSERT INTO effects VALUES('e',0)").run();
const a = new SQLiteWriterEpochStore(path);
const b = new SQLiteWriterEpochStore(path);
const value = () => (admin.prepare("SELECT value FROM effects WHERE id='e'").get() as {value:number}).value;
const write = (store:SQLiteWriterEpochStore,epoch:number,ownerId:string) =>
 store.guardedUpdate({scope:"outbox",epoch,ownerId,sql:"UPDATE effects SET value=value+1 WHERE id=?",params:["e"]});
try {
 const first=a.rotate("outbox","A");
 assert.equal(first.epoch,1);
 assert.equal(write(a,1,"A"),1);
 const second=b.rotate("outbox","B");
 assert.equal(second.epoch,2);
 assert.throws(()=>write(a,1,"A"),(e:unknown)=>e instanceof WriterFenceConflict && e.reason==="stale_writer_fenced");
 assert.throws(()=>write(a,2,"A"),(e:unknown)=>e instanceof WriterFenceConflict && e.reason==="stale_writer_fenced");
 assert.equal(value(),1);
 assert.equal(write(b,2,"B"),1);
 assert.equal(value(),2);
 const reopened = new SQLiteWriterEpochStore(path);
 try {
  assert.deepEqual(reopened.inspect("outbox"),{epoch:2,ownerId:"B"});
  assert.throws(()=>write(reopened,1,"A"),(e:unknown)=>e instanceof WriterFenceConflict);
  assert.equal(reopened.rotate("outbox","C").epoch,3);
  assert.throws(()=>write(b,2,"B"),(e:unknown)=>e instanceof WriterFenceConflict);
  assert.equal(write(reopened,3,"C"),1);
 } finally { reopened.close(); }
 assert.equal(value(),3);
 assert.throws(()=>a.rotate("","A"),(e:unknown)=>e instanceof WriterFenceConflict);
 console.log("Day 77 noon: writer epoch SQLite checks passed");
} finally { a.close(); b.close(); admin.close(); rmSync(dir,{recursive:true,force:true}); }
