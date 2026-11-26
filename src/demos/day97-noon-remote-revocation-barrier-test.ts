import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { day96LabSha256 as hash } from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";
import { SQLiteDay97ControllerLab, SQLiteDay97ResourceLab,
  type Day97BarrierPlan, type Day97OldWrite } from "../runtime/recovery-writer-remote-revocation-barrier-lab.js";

const dir=mkdtempSync(join(tmpdir(),"day97-barrier-"));
const cp=join(dir,"controller.sqlite"), rp=join(dir,"resource.sqlite");
let controller=new SQLiteDay97ControllerLab(cp);
let resource=new SQLiteDay97ResourceLab(rp);
const d="staging:day97", b="barrier-1";
const old=(resourceId:string):Day97OldWrite=>({deploymentId:d,resourceId,requestId:"old-1",principal:"old-worker",fence:41,command:"dummy"});
const plan:Day97BarrierPlan={intent:"isolated_lab",deploymentId:d,releaseId:"release-97",attemptId:"attempt-1",
  barrierId:b,policyEpoch:8,policySha256:hash("policy-8"),targets:[{resourceId:"A",floor:42},{resourceId:"B",floor:42}]};
try {
  assert.equal(resource.seed(old("A"),7).status,"seeded");
  assert.equal(resource.seed(old("B"),7).status,"seeded");
  assert.equal(controller.begin({...plan,intent:"production_release"},null).publishAuthorized,false);
  assert.equal(controller.begin(plan,null).status,"revocation_pending");
  assert.equal(controller.begin(plan,null).status,"barrier_cas_conflict");
  const [a,bc]=controller.pending(d,b);
  assert.equal(a.resourceId,"A");
  // A commits floor, but response is lost. B is partitioned.
  const first=resource.install(a,"isolated_lab");
  assert.equal(first.status,"installed_fixture");
  assert.equal(controller.pending(d,b).length,2);
  assert.equal(resource.write(old("A"),"isolated_lab").status,"stale_fence");
  assert.equal(resource.effectCount(d,"A"),0);
  // B has not received revocation and can still commit an old effect.
  assert.equal(resource.write(old("B"),"isolated_lab").status,"effect_committed_fixture");
  controller.close(); resource.close();
  controller=new SQLiteDay97ControllerLab(cp); resource=new SQLiteDay97ResourceLab(rp);
  assert.equal(controller.pending(d,b).length,2);
  const retry=resource.install(a,"isolated_lab");
  assert.equal(retry.status,"exact_install_replay");
  assert.deepEqual(retry.ack,first.ack);
  assert.equal(resource.install({...a,floor:43},"isolated_lab").status,"invalid_command");
  assert.equal(controller.recordAck(retry.ack!).status,"ack_recorded_fixture");
  assert.equal(controller.recordAck(retry.ack!).status,"exact_ack_replay");
  assert.equal(controller.confirm(d,b,[resource.head(d,"A")!]).status,"revocation_pending");
  // Inject a receipt insert failure; floor and receipt must roll back together.
  const raw=new DatabaseSync(rp);
  try {
    raw.exec("CREATE TRIGGER d97_fail BEFORE INSERT ON d97_receipt BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
    assert.throws(()=>resource.install(bc,"isolated_lab"),/fixture failure/);
    assert.equal(resource.head(d,"B")!.floor,41);
    raw.exec("DROP TRIGGER d97_fail");
  } finally { raw.close(); }
  const second=resource.install(bc,"isolated_lab");
  assert.equal(second.status,"installed_fixture");
  assert.equal(controller.recordAck({...second.ack!,installedFloor:43}).status,"ack_invalid");
  assert.equal(controller.recordAck(second.ack!).status,"ack_recorded_fixture");
  assert.equal(resource.write(old("B"),"isolated_lab").status,"exact_effect_replay");
  assert.equal(resource.effectCount(d,"B"),1);
  assert.equal(resource.write({...old("B"),requestId:"forged",fence:42},"isolated_lab").status,"grant_binding_conflict");
  const heads=[resource.head(d,"A")!,resource.head(d,"B")!];
  assert.equal(controller.confirm(d,b,[heads[0],heads[0]]).status,"current_head_coverage_missing");
  assert.equal(controller.confirm(d,b,[heads[0],{...heads[1],floor:41}]).status,"current_head_conflict");
  assert.equal(controller.confirm(d,b,heads).status,"fixture_revocation_confirmed");
  assert.equal(controller.confirm(d,b,heads).publishAuthorized,false);
  // A different attempt cannot reset the deployment/resource fence namespace.
  const next={...plan,attemptId:"attempt-2",barrierId:"barrier-2",policyEpoch:9,policySha256:hash("policy-9")};
  assert.equal(controller.begin(next,b).status,"floor_not_advanced");
  assert.equal(controller.begin({...next,targets:[{resourceId:"A",floor:43}]},b).status,"epoch_or_inventory_conflict");
  assert.equal(controller.begin({...next,targets:[{resourceId:"A",floor:43},{resourceId:"B",floor:43}]},b).status,"revocation_pending");
  assert.equal(controller.recordAck(retry.ack!).status,"stale_barrier");
  assert.equal(controller.confirm(d,b,heads).status,"stale_barrier");
  const nextA=controller.pending(d,"barrier-2")[0];
  assert.equal(resource.install(nextA,"production_release").status,"production_release_not_authorized");
  assert.equal(resource.install(nextA,"isolated_lab").status,"installed_fixture");
  // Old receipt survives but says nothing about current floor.
  assert.equal(resource.install(a,"isolated_lab").status,"exact_install_replay");
  assert.equal(resource.head(d,"A")!.floor,43);
  assert.equal(resource.seed(old("A"),7).status,"resource_exists");
  console.log("Day 97 remote revocation barrier fixture: PASS (NO_GO)");
} finally { controller.close(); resource.close(); rmSync(dir,{recursive:true,force:true}); }
