/** Day 97: two independent SQLite transaction domains, synthetic fixtures only. */
import { DatabaseSync } from "node:sqlite";
import { day96LabSha256 as hash } from "./recovery-writer-atomic-authorization-fence-lab.js";

export interface Day97BarrierPlan {
  intent: "isolated_lab" | "production_release";
  deploymentId: string; releaseId: string; attemptId: string; barrierId: string;
  policyEpoch: number; policySha256: string;
  targets: readonly { resourceId: string; floor: number }[];
}
export interface Day97FenceCommand {
  deploymentId: string; releaseId: string; attemptId: string; barrierId: string;
  policyEpoch: number; policySha256: string; manifestSha256: string;
  resourceId: string; floor: number; commandId: string; commandSha256: string;
}
export interface Day97FenceAck {
  command: Day97FenceCommand;
  installedFloor: number;
}
export interface Day97Head { deploymentId: string; resourceId: string; floor: number; commandSha256: string }
export interface Day97OldWrite {
  deploymentId: string; resourceId: string; requestId: string; principal: string;
  fence: number; command: string;
}
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const pos = (v: number) => Number.isSafeInteger(v) && v > 0;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const result = (status: string) => ({ status, publishAuthorized: false as const });
const fields = (c: Omit<Day97FenceCommand,"commandSha256">) => [
  c.deploymentId,c.releaseId,c.attemptId,c.barrierId,c.policyEpoch,c.policySha256,
  c.manifestSha256,c.resourceId,c.floor,c.commandId
];
const digest = (c: Omit<Day97FenceCommand,"commandSha256">) => hash(JSON.stringify(["day97-fence",...fields(c)]));
const valid = (c: Day97FenceCommand) => !!c &&
  [c.deploymentId,c.releaseId,c.attemptId,c.barrierId,c.resourceId,c.commandId].every(id) &&
  pos(c.policyEpoch) && pos(c.floor) && sha(c.policySha256) && sha(c.manifestSha256) &&
  c.commandId === hash(JSON.stringify([c.deploymentId,c.barrierId,c.resourceId])) &&
  c.commandSha256 === digest(c);
const same = (a: Day97FenceCommand,b: Day97FenceCommand) => valid(a) && valid(b) &&
  a.commandSha256 === b.commandSha256;
class Store {
  protected readonly db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=250"); }
  close() { this.db.close(); }
  protected tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r=fn(); this.db.exec("COMMIT"); return r; }
    catch(e) { try { this.db.exec("ROLLBACK"); } catch { /* preserve error */ } throw e; }
  }
}
type Barrier = { barrier_id:string; epoch:number; manifest:string; state:string };
type CommandRow = { payload:string; ack:string|null; floor:number };

/** No real identity, protected credentials, or external anti-rollback store. */
export class SQLiteDay97ControllerLab extends Store {
  constructor(path:string) {
    super(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS d97_barrier(
      deployment TEXT PRIMARY KEY, barrier_id TEXT NOT NULL, epoch INTEGER NOT NULL,
      manifest TEXT NOT NULL, state TEXT NOT NULL, issuance_stopped INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS d97_commands(
      deployment TEXT NOT NULL, barrier_id TEXT NOT NULL, resource TEXT NOT NULL,
      payload TEXT NOT NULL, floor INTEGER NOT NULL, ack TEXT,
      PRIMARY KEY(deployment,barrier_id,resource));`);
  }
  private current(d:string) {
    return this.db.prepare("SELECT * FROM d97_barrier WHERE deployment=?").get(d) as Barrier|undefined;
  }
  private rows(d:string,b:string) {
    return this.db.prepare("SELECT payload,ack,floor FROM d97_commands WHERE deployment=? AND barrier_id=? ORDER BY resource")
      .all(d,b) as CommandRow[];
  }
  begin(p:Day97BarrierPlan, expectedBarrierId:string|null) {
    if (p.intent!=="isolated_lab") return result("production_release_not_authorized");
    if (![p.deploymentId,p.releaseId,p.attemptId,p.barrierId].every(id) ||
      !pos(p.policyEpoch) || !sha(p.policySha256) || !p.targets.length ||
      !p.targets.every(t=>id(t.resourceId)&&pos(t.floor)) ||
      new Set(p.targets.map(t=>t.resourceId)).size!==p.targets.length) return result("invalid_plan");
    const targets=[...p.targets].sort((a,b)=>a.resourceId<b.resourceId?-1:a.resourceId>b.resourceId?1:0);
    const manifest=hash(JSON.stringify(targets.map(t=>t.resourceId)));
    return this.tx(()=>{
      const prev=this.current(p.deploymentId);
      if ((prev?.barrier_id??null)!==expectedBarrierId) return result("barrier_cas_conflict");
      if (prev && (p.policyEpoch<=prev.epoch || manifest!==prev.manifest)) return result("epoch_or_inventory_conflict");
      if (this.rows(p.deploymentId,p.barrierId).length) return result("barrier_id_reused");
      for (const t of targets) {
        const old=this.db.prepare("SELECT MAX(floor) AS n FROM d97_commands WHERE deployment=? AND resource=?")
          .get(p.deploymentId,t.resourceId) as {n:number|null};
        if (old.n!==null && t.floor<=old.n) return result("floor_not_advanced");
      }
      this.db.prepare("INSERT INTO d97_barrier VALUES(?,?,?,?,?,1) ON CONFLICT(deployment) DO UPDATE SET barrier_id=excluded.barrier_id,epoch=excluded.epoch,manifest=excluded.manifest,state=excluded.state,issuance_stopped=1")
        .run(p.deploymentId,p.barrierId,p.policyEpoch,manifest,"revocation_pending");
      for(const t of targets) {
        const base={deploymentId:p.deploymentId,releaseId:p.releaseId,attemptId:p.attemptId,
          barrierId:p.barrierId,policyEpoch:p.policyEpoch,policySha256:p.policySha256,manifestSha256:manifest,
          resourceId:t.resourceId,floor:t.floor,commandId:hash(JSON.stringify([p.deploymentId,p.barrierId,t.resourceId]))};
        const c={...base,commandSha256:digest(base)};
        this.db.prepare("INSERT INTO d97_commands VALUES(?,?,?,?,?,NULL)")
          .run(p.deploymentId,p.barrierId,t.resourceId,JSON.stringify(c),t.floor);
      }
      return result("revocation_pending");
    });
  }
  pending(d:string,b:string):Day97FenceCommand[] {
    if(this.current(d)?.barrier_id!==b) return [];
    return this.rows(d,b).filter(r=>r.ack===null).map(r=>JSON.parse(r.payload) as Day97FenceCommand);
  }
  recordAck(a:Day97FenceAck) {
    const c=a?.command;
    if(!valid(c)||a.installedFloor!==c.floor) return result("ack_invalid");
    return this.tx(()=>{
      if(this.current(c.deploymentId)?.barrier_id!==c.barrierId) return result("stale_barrier");
      const r=this.db.prepare("SELECT payload,ack,floor FROM d97_commands WHERE deployment=? AND barrier_id=? AND resource=?")
        .get(c.deploymentId,c.barrierId,c.resourceId) as CommandRow|undefined;
      if(!r||!same(JSON.parse(r.payload) as Day97FenceCommand,c)) return result("ack_binding_conflict");
      if(r.ack!==null) return result("exact_ack_replay");
      this.db.prepare("UPDATE d97_commands SET ack=? WHERE deployment=? AND barrier_id=? AND resource=?")
        .run(JSON.stringify({command:JSON.parse(r.payload),installedFloor:c.floor}),c.deploymentId,c.barrierId,c.resourceId);
      return result("ack_recorded_fixture");
    });
  }
  /** Head observations are caller-supplied fixtures; NOT a live authenticated protocol. */
  confirm(d:string,b:string,heads:readonly Day97Head[]) {
    return this.tx(()=>{
      if(this.current(d)?.barrier_id!==b) return result("stale_barrier");
      const rows=this.rows(d,b);
      if(!rows.length||rows.some(r=>r.ack===null)) return result("revocation_pending");
      if(heads.length!==rows.length||new Set(heads.map(h=>h.resourceId)).size!==heads.length)
        return result("current_head_coverage_missing");
      for(const r of rows) {
        const c=JSON.parse(r.payload) as Day97FenceCommand;
        const a=JSON.parse(r.ack!) as Day97FenceAck;
        const h=heads.find(h=>h.deploymentId===d&&h.resourceId===c.resourceId);
        if(!same(a.command,c)||a.installedFloor!==c.floor||!h||h.floor!==c.floor||h.commandSha256!==c.commandSha256)
          return result("current_head_conflict");
      }
      this.db.prepare("UPDATE d97_barrier SET state=? WHERE deployment=? AND barrier_id=?")
        .run("fixture_revocation_confirmed",d,b);
      return result("fixture_revocation_confirmed");
    });
  }
}
type HeadRow={floor:number; digest:string; epoch:number};
type ReceiptRow={payload:string};
const writeBinding=(q:Day97OldWrite)=>JSON.stringify([q.deploymentId,q.resourceId,q.requestId,q.principal,q.fence,hash(q.command)]);
/** A separate database simulates a remote domain. Old grants are pre-seeded synthetic data. */
export class SQLiteDay97ResourceLab extends Store {
  constructor(path:string) {
    super(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS d97_head(
      deployment TEXT,resource TEXT,floor INTEGER NOT NULL,digest TEXT NOT NULL,epoch INTEGER NOT NULL,
      PRIMARY KEY(deployment,resource));
      CREATE TABLE IF NOT EXISTS d97_receipt(
      deployment TEXT,resource TEXT,command_id TEXT,payload TEXT NOT NULL,
      PRIMARY KEY(deployment,resource,command_id));
      CREATE TABLE IF NOT EXISTS d97_grant(
      deployment TEXT,resource TEXT,request_id TEXT,binding TEXT NOT NULL,
      PRIMARY KEY(deployment,resource,request_id));
      CREATE TABLE IF NOT EXISTS d97_effect(
      deployment TEXT,resource TEXT,request_id TEXT,binding TEXT NOT NULL,
      PRIMARY KEY(deployment,resource,request_id));`);
  }
  private headRow(d:string,r:string) {
    return this.db.prepare("SELECT floor,digest,epoch FROM d97_head WHERE deployment=? AND resource=?").get(d,r) as HeadRow|undefined;
  }
  seed(q:Day97OldWrite,epoch:number) {
    if(![q.deploymentId,q.resourceId,q.requestId,q.principal].every(id)||!pos(q.fence)||!pos(epoch)||typeof q.command!=="string") return result("invalid_fixture");
    return this.tx(()=>{
      if(this.headRow(q.deploymentId,q.resourceId)) return result("resource_exists");
      this.db.prepare("INSERT INTO d97_head VALUES(?,?,?,?,?)").run(q.deploymentId,q.resourceId,q.fence,hash("fixture-old-head"),epoch);
      this.db.prepare("INSERT INTO d97_grant VALUES(?,?,?,?)").run(q.deploymentId,q.resourceId,q.requestId,writeBinding(q));
      return result("seeded");
    });
  }
  head(d:string,r:string):Day97Head|null {
    const row=this.headRow(d,r);
    return row?{deploymentId:d,resourceId:r,floor:row.floor,commandSha256:row.digest}:null;
  }
  install(c:Day97FenceCommand, intent:"isolated_lab"|"production_release"):{status:string;ack?:Day97FenceAck;publishAuthorized:false} {
    if(intent!=="isolated_lab") return result("production_release_not_authorized");
    if(!valid(c)) return result("invalid_command");
    return this.tx(()=>{
      const prior=this.db.prepare("SELECT payload FROM d97_receipt WHERE deployment=? AND resource=? AND command_id=?")
        .get(c.deploymentId,c.resourceId,c.commandId) as ReceiptRow|undefined;
      if(prior) {
        const a=JSON.parse(prior.payload) as Day97FenceAck;
        return same(a.command,c)?{...result("exact_install_replay"),ack:a}:result("command_conflict");
      }
      const h=this.headRow(c.deploymentId,c.resourceId);
      if(!h) return result("unknown_resource");
      if(c.floor<=h.floor||c.policyEpoch<=h.epoch) return result("floor_or_epoch_not_advanced");
      const ack={command:c,installedFloor:c.floor};
      this.db.prepare("UPDATE d97_head SET floor=?,digest=?,epoch=? WHERE deployment=? AND resource=?")
        .run(c.floor,c.commandSha256,c.policyEpoch,c.deploymentId,c.resourceId);
      this.db.prepare("INSERT INTO d97_receipt VALUES(?,?,?,?)")
        .run(c.deploymentId,c.resourceId,c.commandId,JSON.stringify(ack));
      return {...result("installed_fixture"),ack};
    });
  }
  write(q:Day97OldWrite,intent:"isolated_lab"|"production_release") {
    if(intent!=="isolated_lab") return result("production_release_not_authorized");
    if(![q.deploymentId,q.resourceId,q.requestId,q.principal].every(id)||!pos(q.fence)||typeof q.command!=="string") return result("invalid_fixture");
    return this.tx(()=>{
      const binding=writeBinding(q);
      const g=this.db.prepare("SELECT binding FROM d97_grant WHERE deployment=? AND resource=? AND request_id=?")
        .get(q.deploymentId,q.resourceId,q.requestId) as {binding:string}|undefined;
      if(!g||g.binding!==binding) return result("grant_binding_conflict");
      const prior=this.db.prepare("SELECT binding FROM d97_effect WHERE deployment=? AND resource=? AND request_id=?")
        .get(q.deploymentId,q.resourceId,q.requestId) as {binding:string}|undefined;
      if(prior) return result(prior.binding===binding?"exact_effect_replay":"effect_conflict");
      if(this.headRow(q.deploymentId,q.resourceId)?.floor!==q.fence) return result("stale_fence");
      this.db.prepare("INSERT INTO d97_effect VALUES(?,?,?,?)").run(q.deploymentId,q.resourceId,q.requestId,binding);
      return result("effect_committed_fixture");
    });
  }
  effectCount(d:string,r:string) {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM d97_effect WHERE deployment=? AND resource=?").get(d,r) as {n:number}).n;
  }
}
