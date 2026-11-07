import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { RecoveryDeliveryConflict } from "../runtime/recovery-outbox-delivery-lease.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
const dir=mkdtempSync(join(tmpdir(),"day78-"));
const path=join(dir,"test.db"),now=Date.UTC(2026,10,7,4);
const contract={durableDedupeByEventId:true,dedupeRetentionSeconds:7200,deliveryRecoveryWindowSeconds:3600,authenticatedEventAck:true};
const record:RecoveryOutboxRecord={id:"cmd:terminal",eventId:"event:cmd",commandId:"cmd",runId:"run",kind:"audit",payload:"{}",status:"pending",attempts:0,version:1,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
const admin=new DatabaseSync(path);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)").run(record.id,record.eventId,record.commandId,record.runId,JSON.stringify(record),record.createdAt);
const a=new SQLiteFencedOutboxDelivery(path),b=new SQLiteFencedOutboxDelivery(path);
function stale(fn:()=>unknown){assert.throws(fn,(e:unknown)=>e instanceof RecoveryDeliveryConflict&&e.reason==="stale_writer_fenced");}
try{
 const epochA=a.rotate("A");
 assert.equal(epochA,1);
 const first=a.claim({outboxId:record.id,workerId:"A",epoch:epochA,consumer:contract,nowEpochMs:now,leaseMs:1000});
 assert.equal(first.action,"claimed");
 if(first.action!=="claimed")throw Error("claim missing");
 const epochB=b.rotate("B");
 assert.equal(epochB,2);
 stale(()=>a.claim({outboxId:record.id,workerId:"A",epoch:epochA,consumer:contract,nowEpochMs:now+1000,leaseMs:1000}));
 stale(()=>a.acknowledge({outboxId:record.id,eventId:record.eventId,workerId:"A",epoch:epochA,leaseToken:first.leaseToken,nowEpochMs:now+10}));
 assert.equal(a.inspect(record.id)?.status,"pending");
 const second=b.claim({outboxId:record.id,workerId:"B",epoch:epochB,consumer:contract,nowEpochMs:now+1000,leaseMs:1000});
 assert.equal(second.action,"claimed");
 if(second.action!=="claimed")throw Error("second claim missing");
 assert.equal(b.acknowledge({outboxId:record.id,eventId:record.eventId,workerId:"B",epoch:epochB,leaseToken:second.leaseToken,nowEpochMs:now+1010}).action,"dispatched");
 assert.equal(a.inspect(record.id)?.status,"dispatched");
 const reopened=new SQLiteFencedOutboxDelivery(path);
 try{stale(()=>reopened.acknowledge({outboxId:record.id,eventId:record.eventId,workerId:"A",epoch:epochA,leaseToken:first.leaseToken,nowEpochMs:now+1020}));}finally{reopened.close();}
 console.log("PASS Day 78 fenced claim/ack and reopen");
}finally{a.close();b.close();admin.close();rmSync(dir,{recursive:true,force:true});}
