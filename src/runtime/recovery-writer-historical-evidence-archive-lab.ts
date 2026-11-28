/** Day 99: isolated candidate evidence archive. No production identity or authority. */
import { DatabaseSync } from "node:sqlite";
import { day96LabSha256 as hash } from "./recovery-writer-atomic-authorization-fence-lab.js";
import { classifyDay98InflightEffect, type Day98InflightIntent,
  type Day98EffectObservation } from "./recovery-writer-inflight-effect-reconciliation.js";

type Terminal = Exclude<Day98EffectObservation,{kind:"unknown"}>;
export interface Day99FrozenIntent {
  tenantId:string; runId:string; originalActor:string; intent:Day98InflightIntent;
}
export interface Day99ArchiveRequest {
  mode:"isolated_lab"|"production_release";
  tenantId:string; runId:string; effectId:string; expectedRevision:number;
  operation:"archive_historical_evidence"; evidenceId:string; observation:Terminal;
}
type Outcome = {status:string; archiveId?:string; observationTrusted:false;
  automaticResend:false; publishAuthorized:false};
const result = (status:string, archiveId?:string):Outcome =>
  ({status,...(archiveId ? {archiveId} : {}),observationTrusted:false,
    automaticResend:false,publishAuthorized:false});
const id = (x:unknown):x is string => typeof x==="string" && /^[A-Za-z0-9._:-]{1,256}$/.test(x);
const pos = (x:unknown):x is number => typeof x==="number" && Number.isSafeInteger(x) && x>0;
const keys = ["deploymentId","releaseId","attemptId","barrierId","resourceId",
  "providerId","commandId","effectId","idempotencyKey","originalFence",
  "commandSha256","targetFloor","barrierCommandSha256"] as const;
const canonicalIntent = (i:Day98InflightIntent) => JSON.stringify(keys.map(k=>i[k]));
const validIntent = (i:Day98InflightIntent) =>
  classifyDay98InflightEffect(i,undefined,[]).reason==="observation_unavailable";
function observationJson(o:Terminal, i:Day98InflightIntent):string|null {
  if (!o || !o.binding || canonicalIntent(o.binding)!==canonicalIntent(i)) return null;
  if (o.kind==="applied" && id(o.receiptId) &&
      (o.journalId===undefined || id(o.journalId)) &&
      (o.commitOrdinal===undefined || pos(o.commitOrdinal))) {
    return JSON.stringify(["applied",o.receiptId,o.journalId??null,o.commitOrdinal??null]);
  }
  if (o.kind==="not_applied" && typeof o.final==="boolean" &&
      typeof o.noLateCommitGuarantee==="boolean") {
    return JSON.stringify(["not_applied",o.final,o.noLateCommitGuarantee]);
  }
  return null;
}
export class SQLiteDay99HistoricalEvidenceArchiveLab {
  private readonly db:DatabaseSync;
  constructor(path:string) {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=250;
      CREATE TABLE IF NOT EXISTS day99_lab_intent(
        tenant TEXT, run TEXT, effect TEXT, original_actor TEXT NOT NULL,
        intent_json TEXT NOT NULL, PRIMARY KEY(tenant,run,effect));
      CREATE TABLE IF NOT EXISTS day99_lab_grant(
        tenant TEXT, run TEXT, effect TEXT, principal TEXT, revision INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), PRIMARY KEY(tenant,run,effect,principal));
      CREATE TABLE IF NOT EXISTS day99_lab_evidence(
        tenant TEXT, provider TEXT, evidence_id TEXT, archive_id TEXT NOT NULL UNIQUE,
        run TEXT NOT NULL, effect TEXT NOT NULL, original_actor TEXT NOT NULL,
        archived_by TEXT NOT NULL, revision INTEGER NOT NULL, canonical_json TEXT NOT NULL,
        digest TEXT NOT NULL, source TEXT NOT NULL CHECK(source='synthetic_candidate'),
        PRIMARY KEY(tenant,provider,evidence_id));
      CREATE TABLE IF NOT EXISTS day99_lab_audit(
        seq INTEGER PRIMARY KEY, archive_id TEXT NOT NULL, principal TEXT NOT NULL,
        revision INTEGER NOT NULL, event TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  private tx<T>(fn:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const v=fn();this.db.exec("COMMIT");return v; }
    catch(e){try{this.db.exec("ROLLBACK");}catch{/* preserve error */}throw e;}
  }
  /** Trusted fixture setup only; never call from an untrusted request handler. */
  seedFrozen(f:Day99FrozenIntent):void {
    if (![f.tenantId,f.runId,f.originalActor].every(id)||!validIntent(f.intent))
      throw Error("invalid_frozen_intent");
    this.tx(()=>{
      const j=JSON.stringify(Object.fromEntries(keys.map(k=>[k,f.intent[k]])));
      this.db.prepare("INSERT INTO day99_lab_intent VALUES(?,?,?,?,?)")
        .run(f.tenantId,f.runId,f.intent.effectId,f.originalActor,j);
    });
  }
  /** Fixture control plane, grant is only for archive on one effect. CAS revision. */
  setGrant(tenant:string,run:string,effect:string,principal:string,expected:number,enabled:boolean):boolean {
    if (![tenant,run,effect,principal].every(id)||!Number.isSafeInteger(expected)||
        expected<0||expected>=Number.MAX_SAFE_INTEGER||typeof enabled!=="boolean") return false;
    return this.tx(()=>{
      const f=this.db.prepare("SELECT 1 FROM day99_lab_intent WHERE tenant=? AND run=? AND effect=?")
        .get(tenant,run,effect);
      if(!f)return false;
      const g=this.db.prepare("SELECT revision FROM day99_lab_grant WHERE tenant=? AND run=? AND effect=? AND principal=?")
        .get(tenant,run,effect,principal) as {revision:number}|undefined;
      if((g?.revision??0)!==expected)return false;
      this.db.prepare(`INSERT INTO day99_lab_grant VALUES(?,?,?,?,?,?)
        ON CONFLICT(tenant,run,effect,principal) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled`)
        .run(tenant,run,effect,principal,expected+1,enabled?1:0);
      return true;
    });
  }
  /** principal is injected by a LAB caller, not read from request JSON. */
  archive(principal:string,q:Day99ArchiveRequest):Outcome {
    if(q?.mode!=="isolated_lab")return result("production_release_not_authorized");
    if(!id(principal)||![q.tenantId,q.runId,q.effectId,q.evidenceId].every(id)||
        !pos(q.expectedRevision)||q.operation!=="archive_historical_evidence")
      return result("invalid_archive_request");
    return this.tx(()=>{
      const g=this.db.prepare("SELECT revision,enabled FROM day99_lab_grant WHERE tenant=? AND run=? AND effect=? AND principal=?")
        .get(q.tenantId,q.runId,q.effectId,principal) as {revision:number;enabled:number}|undefined;
      if(!g||g.enabled!==1||g.revision!==q.expectedRevision)return result("permission_denied");
      const f=this.db.prepare("SELECT original_actor,intent_json FROM day99_lab_intent WHERE tenant=? AND run=? AND effect=?")
        .get(q.tenantId,q.runId,q.effectId) as {original_actor:string;intent_json:string}|undefined;
      if(!f)return result("permission_denied");
      const i=JSON.parse(f.intent_json) as Day98InflightIntent;
      if(!validIntent(i)||i.effectId!==q.effectId||!id(f.original_actor))throw Error("invalid_frozen_state");
      const o=observationJson(q.observation,i);
      if(o===null)return result("evidence_binding_or_schema_conflict");
      // Fixed allowlist, bounded IDs/ordinals; no arbitrary raw payload or credentials stored.
      const j=JSON.stringify([q.tenantId,q.runId,f.original_actor,canonicalIntent(i),q.evidenceId,o,"synthetic_candidate"]);
      const digest=hash(j);
      const prior=this.db.prepare("SELECT archive_id,canonical_json,digest,run,effect FROM day99_lab_evidence WHERE tenant=? AND provider=? AND evidence_id=?")
        .get(q.tenantId,i.providerId,q.evidenceId) as {archive_id:string;canonical_json:string;digest:string;run:string;effect:string}|undefined;
      if(prior){
        if(prior.canonical_json===j&&prior.digest===digest)return result("exact_archive_replay",prior.archive_id);
        // Do not expose another effect's archive ID through conflict responses or audit.
        if(prior.run===q.runId&&prior.effect===q.effectId)
          this.db.prepare("INSERT INTO day99_lab_audit(archive_id,principal,revision,event) VALUES(?,?,?,'conflict')")
            .run(prior.archive_id,principal,g.revision);
        return result("evidence_conflict");
      }
      const archiveId=hash(JSON.stringify([q.tenantId,i.providerId,q.evidenceId]));
      this.db.prepare("INSERT INTO day99_lab_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(q.tenantId,i.providerId,q.evidenceId,archiveId,q.runId,q.effectId,f.original_actor,
          principal,g.revision,j,digest,"synthetic_candidate");
      this.db.prepare("INSERT INTO day99_lab_audit(archive_id,principal,revision,event) VALUES(?,?,?,'archived')")
        .run(archiveId,principal,g.revision);
      return result("candidate_archived",archiveId);
    });
  }
}
