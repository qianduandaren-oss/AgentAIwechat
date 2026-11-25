import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteDay96AtomicAuthorizationLab, day96LabSha256,
  type Day96LabPolicy, type Day96IssueRequest, type Day96ConsumeRequest
} from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";

const dir = mkdtempSync(join(tmpdir(),"day96-auth-fence-"));
const path = join(dir,"fixture.sqlite");
let now = Date.UTC(2026,10,25,4);
const start = now;
const hash = day96LabSha256;
const controller = new SQLiteDay96AtomicAuthorizationLab(path,()=>now);
let resource: SQLiteDay96AtomicAuthorizationLab | null = new SQLiteDay96AtomicAuthorizationLab(path,()=>now);
const raw = new DatabaseSync(path);
const policy = (resourceId:string): Day96LabPolicy => ({
  deploymentId:"staging:day96", releaseId:"release-96", attemptId:"attempt-"+resourceId,
  resourceId, policyEpoch:7, policySha256:hash("policy-7"),
  keySpkiSha256:hash("fixture-key"), keyActive:true, notBeforeEpochMs:start-1000,
  policyExpiresAtEpochMs:start+60_000, checkpointSequence:2,
  eventSha256:hash("audit-head-2"), evidenceSha256:hash("synthetic-evidence-"+resourceId),
  evidenceExpiresAtEpochMs:start+30_000
});
const request = (expected:Day96LabPolicy, requestId="req-1"): Day96IssueRequest => ({
  intent:"isolated_lab", expected, requestId, principal:"worker-A",
  operation:"dummy_write", commandSha256:hash("fixture command"), expiresAtEpochMs:start+5000
});
const use = (q:Day96IssueRequest, fence:number): Day96ConsumeRequest => ({
  intent:"isolated_lab", deploymentId:q.expected.deploymentId, releaseId:q.expected.releaseId,
  attemptId:q.expected.attemptId, resourceId:q.expected.resourceId, requestId:q.requestId,
  principal:q.principal, operation:q.operation, command:"fixture command", fence
});
try {
  const before = policy("before");
  assert.equal(controller.initialize(before).status,"initialized");
  assert.equal(controller.revoke(before).status,"revoked");
  assert.equal(resource.issue(request(before)).status,"policy_cas_conflict");
  assert.equal(controller.initialize(before).status,"state_exists");

  const stale = policy("stale");
  controller.initialize(stale);
  const q = request(stale);
  const grant = controller.issue(q);
  assert.equal(grant.status,"issued"); assert.equal(grant.fence,1);
  assert.equal(resource.issue(q).status,"exact_issue_replay");
  assert.equal(resource.issue(request(stale,"req-2")).status,"attempt_already_issued");
  assert.equal(resource.issue({...q,principal:"other"}).status,"request_conflict");
  assert.equal(controller.revoke(stale).fence,2);
  // Resource has never received a new worker effect, but revocation already advanced floor.
  assert.equal(resource.consume(use(q,1)).status,"stale_fence");
  assert.equal(resource.effectCount("stale"),0);
  assert.equal(resource.issue(q).status,"policy_cas_conflict");

  const normal = policy("normal");
  controller.initialize(normal);
  const n = request(normal);
  assert.equal(controller.issue({...n,intent:"production_release"}).status,"production_release_not_authorized");
  assert.equal(controller.issue({...n,expiresAtEpochMs:start+31_000}).status,"capability_window_invalid");
  assert.equal(controller.issue({...n,expected:{...normal,eventSha256:hash("fork")}}).status,"policy_cas_conflict");
  raw.exec("BEGIN IMMEDIATE");
  try { assert.throws(()=>resource!.issue(n),/locked|busy|SQLITE_BUSY/i); }
  finally { raw.exec("ROLLBACK"); }
  assert.equal(resource.issue(n).fence,1); // resource scope is independent
  const cmd = use(n,1);
  assert.equal(resource.consume({...cmd,principal:"worker-B"}).status,"capability_binding_conflict");
  assert.equal(resource.consume({...cmd,attemptId:"other"}).status,"capability_binding_conflict");
  assert.equal(resource.consume({...cmd,command:"different"}).status,"capability_binding_conflict");
  assert.equal(resource.consume({...cmd,fence:2}).status,"capability_binding_conflict");
  assert.equal(resource.consume({...cmd,intent:"production_release"}).publishAuthorized,false);
  assert.equal(resource.effectCount("normal"),0);

  // Fault after receipt update, before effect commit: both must roll back.
  raw.exec("CREATE TRIGGER day96_test_fault BEFORE INSERT ON day96_lab_effect BEGIN SELECT RAISE(ABORT,'injected_effect_failure'); END;");
  assert.throws(()=>resource!.consume(cmd),/injected_effect_failure/);
  assert.equal(resource.effectCount("normal"),0);
  raw.exec("DROP TRIGGER day96_test_fault");
  const effect = resource.consume(cmd);
  assert.equal(effect.status,"effect_committed"); assert.ok(effect.receipt);
  assert.equal(effect.publishAuthorized,false);
  assert.equal(resource.effectCount("normal"),1);
  assert.equal(controller.revoke(normal).status,"revoked");
  resource.close(); resource=null;
  resource = new SQLiteDay96AtomicAuthorizationLab(path,()=>now);
  const replay = resource.consume(cmd);
  assert.equal(replay.status,"exact_effect_replay");
  assert.deepEqual(replay.receipt,effect.receipt);
  assert.equal(resource.effectCount("normal"),1);
  assert.equal(resource.consume({...cmd,command:"different"}).status,"capability_binding_conflict");
  assert.equal(resource.consume(use(q,1)).status,"stale_fence");

  const expired = policy("expired");
  controller.initialize(expired);
  const e = request(expired);
  assert.equal(controller.issue(e).status,"issued");
  now=start+5000;
  assert.equal(resource.consume(use(e,1)).status,"capability_expired_or_revoked");
  assert.equal(resource.effectCount("expired"),0);
  const evidence = policy("evidence");
  controller.initialize(evidence);
  now=start+30_000;
  assert.equal(controller.issue(request(evidence)).status,"policy_not_eligible");
  console.log("Day 96 isolated atomic authorization and resource fence checks passed; production NO_GO");
} finally {
  resource?.close(); raw.close(); controller.close();
  rmSync(dir,{recursive:true,force:true});
}
