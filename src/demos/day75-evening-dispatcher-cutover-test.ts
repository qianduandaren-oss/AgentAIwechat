import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import { SQLiteRecoveryOutboxDeliveryClaimer } from "../runtime/recovery-outbox-delivery-lease.js";
import { RecoveryVerifiedDeliveryGateway } from "../runtime/recovery-verified-delivery-gateway.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const dir = mkdtempSync(join(tmpdir(), "day75-evening-"));
const file = join(dir, "producer.sqlite");
const now = Date.UTC(2026,10,4,10);
const db = new DatabaseSync(file);
db.exec(RECOVERY_FINALIZATION_SCHEMA);
const event: RecoveryOutboxRecord = {
  id:"cmd:terminal",eventId:"evt-75",commandId:"cmd",runId:"run",
  kind:"audit",payload:"{}",status:"pending",attempts:0,version:1,
  createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()
};
db.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES (?,?,?,?,?,?)")
  .run(event.id,event.eventId,event.commandId,event.runId,JSON.stringify(event),event.createdAt);
const store = new SQLiteRecoveryOutboxDeliveryClaimer(file);
const consumer = {durableDedupeByEventId:true,dedupeRetentionSeconds:7200,deliveryRecoveryWindowSeconds:3600,authenticatedEventAck:true};
const evidence = {eventId:event.eventId,outboxId:event.id,commandId:event.commandId,runId:event.runId,consumerId:"consumer-a",evidenceId:"proof-75",observedAtEpochMs:now+10};
let tests=0;
try {
  const gateway = new RecoveryVerifiedDeliveryGateway(store,{verify:async () => evidence},consumer,"consumer-a");
  const first = gateway.claim({outboxId:event.id,workerId:"a",nowEpochMs:now,leaseMs:1000});
  assert.equal(first.action,"claimed"); tests++;
  if(first.action!=="claimed") throw Error("missing claim");
  assert.equal(gateway.claim({outboxId:event.id,workerId:"b",nowEpochMs:now+1,leaseMs:1000}).action,"busy"); tests++;
  const bad = new RecoveryVerifiedDeliveryGateway(store,{verify:async () => null},consumer,"consumer-a");
  assert.equal((await bad.confirm({outboxId:event.id,eventId:event.eventId,leaseToken:first.leaseToken,rawResponse:{},nowEpochMs:now+20,maxEvidenceAgeMs:30000})).action,"hold"); tests++;
  assert.equal(store.inspect(event.id)?.status,"pending"); tests++;
  await assert.rejects(gateway.confirm({outboxId:event.id,eventId:event.eventId,leaseToken:"forged",rawResponse:{},nowEpochMs:now+20,maxEvidenceAgeMs:30000}),/ack_binding_mismatch/); tests++;
  assert.equal((await gateway.confirm({outboxId:event.id,eventId:event.eventId,leaseToken:first.leaseToken,rawResponse:{},nowEpochMs:now+20,maxEvidenceAgeMs:30000})).action,"dispatched"); tests++;
  assert.equal(store.inspect(event.id)?.status,"dispatched"); tests++;
  console.log("Day 75 evening: "+tests+" gateway assertions passed");
} finally {store.close();db.close();rmSync(dir,{recursive:true,force:true});}
