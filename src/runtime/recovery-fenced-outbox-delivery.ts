import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "./sqlite-recovery-finalization.js";
import { planRecoveryOutboxDelivery, type RecoveryOutboxConsumerContract } from "./recovery-outbox-delivery-contract.js";
import type { RecoveryOutboxRecord } from "./recovery-outbox.js";
import { RecoveryDeliveryConflict } from "./recovery-outbox-delivery-lease.js";
import type { RecoveryWriterTrustWatermark } from "./recovery-writer-trust-watermark-contract.js";
import { assertRecoveryWriterTrustMatch, RecoveryWriterTrustFenceConflict } from "./recovery-writer-transactional-trust-contract.js";

const SCHEMA = `CREATE TABLE IF NOT EXISTS recovery_writer_fence(scope TEXT PRIMARY KEY,epoch INTEGER NOT NULL CHECK(epoch>0),owner_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_outbox_delivery_leases(outbox_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,worker_id TEXT NOT NULL,lease_token TEXT NOT NULL UNIQUE,lease_expires_ms INTEGER NOT NULL,attempt INTEGER NOT NULL);`;
type Fence = {epoch:number;owner_id:string};
type Lease = {event_id:string;worker_id:string;lease_token:string;lease_expires_ms:number;attempt:number};
type Row = {id:string;event_id:string;command_id:string;run_id:string;payload:string};
function deny(reason:string):never {throw new RecoveryDeliveryConflict(reason);}
function valid(n:number):boolean {return Number.isSafeInteger(n)&&n>=0;}
/** Candidate only. Legacy direct SQL remains a bypass. Trusted coordinator controls rotate(). */
export class SQLiteFencedOutboxDelivery {
 private db:DatabaseSync;
 /** Optional to preserve historical tests. Production must NEVER use unfenced legacy mode. */
 private readonly activeTrustWatermark: RecoveryWriterTrustWatermark | null;
 constructor(path:string, options?:Readonly<{activeTrustWatermark:RecoveryWriterTrustWatermark}>) {
  this.activeTrustWatermark=options ? Object.freeze({...options.activeTrustWatermark}) : null;
  this.db=new DatabaseSync(path);
  this.db.exec("PRAGMA busy_timeout=5000");
  this.db.exec(RECOVERY_FINALIZATION_SCHEMA);
  this.db.exec(SCHEMA);
 }
 close(){this.db.close();}
 /** Day 85 noon: candidate factory must verify the same DB row before exposing a writer. */
 assertTrustBoundForIsolatedStartup():void {
  if(!this.activeTrustWatermark) {
   throw new RecoveryWriterTrustFenceConflict("trusted_active_watermark_invalid");
  }
  this.transaction(()=>this.assertTrustInTransaction());
 }

 private transaction<T>(fn:()=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const result=fn();this.db.exec("COMMIT");return result;}catch(e){this.db.exec("ROLLBACK");throw e;}}
 rotate(ownerId:string):number {
  if(!ownerId.trim())deny("invalid_owner");
  return this.transaction(()=>{
   // Day 84 evening: a stale policy must not rotate the writer epoch either.
   // The same SQLite write lock serializes this check with policy CAS.
   this.assertTrustInTransaction();
   const prev=this.db.prepare("SELECT epoch FROM recovery_writer_fence WHERE scope='outbox'").get() as {epoch:number}|undefined;
   const epoch=(prev?.epoch??0)+1;
   if(!Number.isSafeInteger(epoch))deny("epoch_overflow");
   this.db.prepare("INSERT INTO recovery_writer_fence(scope,epoch,owner_id) VALUES('outbox',?,?) ON CONFLICT(scope) DO UPDATE SET epoch=excluded.epoch,owner_id=excluded.owner_id").run(epoch,ownerId);
   return epoch;
  });
 }
 /**
  * Day 84 noon: must run INSIDE the same BEGIN IMMEDIATE transaction/DatabaseSync
  * that mutates recovery_outbox. Missing trust table/row is a hard failure.
  * Active trust is injected by the trusted bootstrap, never from RPC JSON.
  * No ATTACH and no secondary SQLite connection: both mutations share one writer lock.
  */
 private assertTrustInTransaction():void {
  const active=this.activeTrustWatermark;
  if(!active)return; // Legacy mode for older isolated regression tests; NOT production-safe.
  const row=this.db.prepare("SELECT deployment_id,revision,policy_sha256 FROM recovery_writer_trust_watermarks WHERE deployment_id=?")
   .get(active.deploymentId) as {deployment_id:string;revision:number;policy_sha256:string}|undefined;
  assertRecoveryWriterTrustMatch(active,row?{
   deploymentId:row.deployment_id,revision:row.revision,policySha256:row.policy_sha256
  }:null);
 }
 private assertFence(ownerId:string,epoch:number) {
  const fence=this.db.prepare("SELECT epoch,owner_id FROM recovery_writer_fence WHERE scope='outbox'").get() as Fence|undefined;
  if(!fence||fence.epoch!==epoch||fence.owner_id!==ownerId)deny("stale_writer_fenced");
 }
 private read(id:string):RecoveryOutboxRecord {
  const row=this.db.prepare("SELECT * FROM recovery_outbox WHERE id=?").get(id) as Row|undefined;
  if(!row)deny("outbox_missing");
  let r:RecoveryOutboxRecord;
  try {r=JSON.parse(row.payload) as RecoveryOutboxRecord;}catch{deny("outbox_payload_invalid");}
  if(r.id!==row.id||r.eventId!==row.event_id||r.commandId!==row.command_id||r.runId!==row.run_id)deny("outbox_identity_mismatch");
  return r;
 }
 inspect(id:string){try{return this.read(id);}catch(e){if(e instanceof RecoveryDeliveryConflict&&e.reason==="outbox_missing")return undefined;throw e;}}
 private write(current:RecoveryOutboxRecord,next:RecoveryOutboxRecord){
  const result=this.db.prepare("UPDATE recovery_outbox SET payload=? WHERE id=? AND event_id=? AND json_extract(payload,'$.version')=? AND json_extract(payload,'$.status')=?").run(JSON.stringify(next),current.id,current.eventId,current.version,current.status);
  if(result.changes!==1)deny("outbox_cas_conflict");
 }
 claim(input:{outboxId:string;workerId:string;epoch:number;consumer:RecoveryOutboxConsumerContract;nowEpochMs:number;leaseMs:number}) {
  if(!input.workerId?.trim()||!valid(input.nowEpochMs)||!Number.isSafeInteger(input.leaseMs)||input.leaseMs<=0||!Number.isSafeInteger(input.nowEpochMs+input.leaseMs))deny("invalid_claim_input");
  return this.transaction(()=>{
   this.assertTrustInTransaction();
   this.assertFence(input.workerId,input.epoch);
   const record=this.read(input.outboxId);
   const plan=planRecoveryOutboxDelivery(record,input.consumer);
   if(plan.action!=="requires_atomic_delivery_claim")return plan;
   const old=this.db.prepare("SELECT * FROM recovery_outbox_delivery_leases WHERE outbox_id=?").get(record.id) as Lease|undefined;
   if(old&&old.event_id!==record.eventId)deny("lease_identity_mismatch");
   if(old&&old.lease_expires_ms>input.nowEpochMs)return {action:"busy" as const};
   const leaseToken=randomUUID(),expires=input.nowEpochMs+input.leaseMs;
   const next={...record,attempts:record.attempts+1,version:record.version+1,updatedAt:new Date(input.nowEpochMs).toISOString()};
   this.write(record,next);
   this.db.prepare("INSERT INTO recovery_outbox_delivery_leases(outbox_id,event_id,worker_id,lease_token,lease_expires_ms,attempt) VALUES(?,?,?,?,?,?) ON CONFLICT(outbox_id) DO UPDATE SET event_id=excluded.event_id,worker_id=excluded.worker_id,lease_token=excluded.lease_token,lease_expires_ms=excluded.lease_expires_ms,attempt=excluded.attempt").run(record.id,record.eventId,input.workerId,leaseToken,expires,next.attempts);
   return {action:"claimed" as const,record:next,leaseToken};
  });
 }
 /** Call only after a trusted ACK adapter has verified the remote response. */
 acknowledge(input:{outboxId:string;eventId:string;workerId:string;epoch:number;leaseToken:string;nowEpochMs:number}) {
  if(!valid(input.nowEpochMs)||!input.leaseToken?.trim())deny("invalid_ack");
  return this.transaction(()=>{
   this.assertTrustInTransaction();
   this.assertFence(input.workerId,input.epoch);
   const record=this.read(input.outboxId);
   const lease=this.db.prepare("SELECT * FROM recovery_outbox_delivery_leases WHERE outbox_id=?").get(input.outboxId) as Lease|undefined;
   if(record.eventId!==input.eventId||!lease||lease.event_id!==input.eventId||lease.worker_id!==input.workerId||lease.lease_token!==input.leaseToken)deny("ack_binding_mismatch");
   if(record.status==="dispatched")return {action:"already_dispatched" as const};
   if(record.status!=="pending"||lease.lease_expires_ms<=input.nowEpochMs||lease.attempt!==record.attempts)deny("ack_stale_lease");
   const timestamp=new Date(input.nowEpochMs).toISOString();
   this.write(record,{...record,status:"dispatched",version:record.version+1,updatedAt:timestamp,dispatchedAt:timestamp});
   return {action:"dispatched" as const};
  });
 }
}
