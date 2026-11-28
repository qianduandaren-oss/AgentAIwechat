import {strict as assert} from "node:assert";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {day96LabSha256 as hash} from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";
import {SQLiteDay99HistoricalEvidenceArchiveLab as Archive,type Day99ArchiveRequest}
  from "../runtime/recovery-writer-historical-evidence-archive-lab.js";
import type {Day98InflightIntent} from "../runtime/recovery-writer-inflight-effect-reconciliation.js";
const dir=mkdtempSync(join(tmpdir(),"day99-")),path=join(dir,"lab.sqlite");
const i:Day98InflightIntent={deploymentId:"d",releaseId:"r",attemptId:"a",barrierId:"b",
  resourceId:"B",providerId:"video",commandId:"cmd",effectId:"effect",idempotencyKey:"key",
  originalFence:41,targetFloor:42,commandSha256:hash("create"),barrierCommandSha256:hash("install")};
const applied={kind:"applied",binding:{...i},receiptId:"receipt",journalId:"journal",commitOrdinal:104} as const;
const q:Day99ArchiveRequest={mode:"isolated_lab",tenantId:"t",runId:"run",effectId:i.effectId,
  expectedRevision:1,operation:"archive_historical_evidence",evidenceId:"e1",observation:applied};
const a=new Archive(path),b=new Archive(path),inspect=new DatabaseSync(path);
try {
  a.seedFrozen({tenantId:"t",runId:"run",originalActor:"worker-A",intent:i});
  assert.equal(a.setGrant("t","run",i.effectId,"worker-A",0,false),true);
  assert.equal(a.setGrant("t","run",i.effectId,"reconciler-B",0,true),true);
  inspect.exec("CREATE TABLE business_fixture(status TEXT); INSERT INTO business_fixture VALUES('unknown')");
  assert.equal(b.archive("worker-A",q).status,"permission_denied");
  assert.equal(b.archive("reconciler-B",{...q,tenantId:"other"}).status,"permission_denied");
  assert.equal(b.archive("reconciler-B",{...q,runId:"other"}).status,"permission_denied");
  assert.equal(b.archive("reconciler-B",{...q,expectedRevision:2}).status,"permission_denied");
  assert.equal(b.archive("reconciler-B",{...q,mode:"production_release"}).status,"production_release_not_authorized");
  assert.equal(b.archive("reconciler-B",{...q,observation:{...applied,binding:{...i,attemptId:"other"}}}).status,"evidence_binding_or_schema_conflict");
  const first=b.archive("reconciler-B",q);
  assert.equal(first.status,"candidate_archived");
  assert.equal(first.observationTrusted,false);assert.equal(first.automaticResend,false);assert.equal(first.publishAuthorized,false);
  const replay=a.archive("reconciler-B",q);
  assert.equal(replay.status,"exact_archive_replay");assert.equal(replay.archiveId,first.archiveId);
  assert.equal(a.archive("reconciler-B",{...q,observation:{...applied,commitOrdinal:106}}).status,"evidence_conflict");
  const saved=inspect.prepare("SELECT original_actor,archived_by,source FROM day99_lab_evidence").get() as
    {original_actor:string;archived_by:string;source:string};
  assert.equal(saved.original_actor,"worker-A");assert.equal(saved.archived_by,"reconciler-B");
  assert.equal(saved.source,"synthetic_candidate");
  const count=(table:string)=> (inspect.prepare("SELECT COUNT(*) AS n FROM "+table).get() as {n:number}).n;
  assert.equal(count("day99_lab_evidence"),1);assert.equal(count("day99_lab_audit"),2);
  inspect.exec("CREATE TRIGGER fail_archive_audit BEFORE INSERT ON day99_lab_audit WHEN NEW.event='archived' BEGIN SELECT RAISE(ABORT,'fixture fault'); END");
  assert.throws(()=>b.archive("reconciler-B",{...q,evidenceId:"e2"}),/fixture fault/);
  assert.equal(count("day99_lab_evidence"),1);assert.equal(count("day99_lab_audit"),2);
  inspect.exec("DROP TRIGGER fail_archive_audit");
  assert.equal(b.archive("reconciler-B",{...q,evidenceId:"e2"}).status,"candidate_archived");
  const reopened=new Archive(path);
  try {assert.equal(reopened.archive("reconciler-B",q).archiveId,first.archiveId);}
  finally {reopened.close();}
  assert.equal(a.setGrant("t","run",i.effectId,"reconciler-B",1,false),true);
  const denied=b.archive("reconciler-B",q);assert.equal(denied.status,"permission_denied");assert.equal(denied.archiveId,undefined);
  assert.equal(a.setGrant("t","run",i.effectId,"reconciler-B",1,true),false);
  assert.equal(count("day99_lab_evidence"),2);
  assert.equal((inspect.prepare("SELECT status FROM business_fixture").get() as {status:string}).status,"unknown");
  console.log("Day 99 archive fixture checks passed (NO_GO)");
} finally {inspect.close();b.close();a.close();rmSync(dir,{recursive:true,force:true});}
