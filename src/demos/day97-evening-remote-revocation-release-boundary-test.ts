import { reviewDay97RemoteRevocationReleaseBoundary as review, type Day97BarrierObservation } from "../runtime/recovery-writer-remote-revocation-release-boundary.js";
import { SQLiteDay97ControllerLab, SQLiteDay97ResourceLab, type Day97BarrierPlan } from "../runtime/recovery-writer-remote-revocation-barrier-lab.js";
import { day96LabSha256 as hash } from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";
import { strict as assert } from "node:assert";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DAY94_AUDIT_GATEWAY_DOMAIN,
  encodeDay94GatewayPayload,
  type Day94AuditGatewayRequest,
  type Day94AuditGatewayPayload,
  type Day94SignedGatewayReply
} from "../runtime/recovery-writer-audit-gateway-contract.js";
import {
  type Day94GatewayTrustPolicy,
  type Day94GatewayPinnedChannel
} from "../runtime/recovery-writer-audit-gateway-pinned-watermark.js";
import {
  reviewDay95LifecycleReleaseBoundary,
  type Day95LifecycleReleaseInput
} from "../runtime/recovery-writer-audit-gateway-lifecycle-release-boundary.js";
import type { Day95LifecyclePolicy } from "../runtime/recovery-writer-audit-gateway-key-lifecycle.js";
import { DAY93_AUDIT_ANCHOR_DOMAIN } from
  "../runtime/recovery-writer-inventory-audit-anchor.js";
import { SQLiteDay93AuditCheckpointStore } from
  "../runtime/recovery-writer-inventory-audit-checkpoint-store.js";
import { SQLiteDay92InventoryFreezeStore } from
  "../runtime/recovery-writer-inventory-freeze-store.js";
import { planDay92InventoryFreezeCandidate } from
  "../runtime/recovery-writer-inventory-freeze-candidate.js";
import { listRequiredCutoverEvidence } from
  "../runtime/recovery-writer-cutover-evidence-coverage.js";
import type { Day91InventorySnapshot } from
  "../runtime/recovery-writer-cutover-inventory-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "day97-evening-composite-"));
const now = Date.UTC(2026, 10, 26, 10, 0, 0);
const scope = {
  deploymentId: "staging:day97-evening",
  releaseId: "release-97", attemptId: "attempt-96-evening",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const expectedAnchor = { snapshotId: "fixture-snapshot-95", revision: "r1" };
const snapshot: Day91InventorySnapshot = {
  ...scope, ...expectedAnchor, hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 2000, expiresAtEpochMs: now + 60_000
};
const inventory = new SQLiteDay92InventoryFreezeStore(join(dir, "freeze.sqlite"));
const audit = new SQLiteDay93AuditCheckpointStore(join(dir, "audit.sqlite"));
const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const wrong = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const publicKeyPem = keys.publicKey;
const spkiSha256 = createHash("sha256")
  .update(createPublicKey(keys.publicKey).export({ type: "spki", format: "der" })).digest("hex");

try {
  const plan = await planDay92InventoryFreezeCandidate({
    intent: "isolated_review", scope, snapshot, expectedAnchor, nowEpochMs: now
  });
  assert.ok(plan.candidate);
  const digest = plan.candidate.manifestSha256;
  assert.equal(inventory.freezeOnce(snapshot, digest).status, "frozen");
  const first = audit.appendOnce({
    domain: DAY93_AUDIT_ANCHOR_DOMAIN,
    deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, ...expectedAnchor,
    manifestSha256: digest, state: "frozen", freezeVersion: 1,
    checkpointSequence: 1, recordedAtEpochMs: now - 1200,
    expiresAtEpochMs: now + 60_000
  }, { checkpointSequence: 0, eventSha256: null });
  assert.equal(first.status, "appended");
  assert.ok("head" in first);
  const headHash = first.head.eventSha256;
  const policy: Day94GatewayTrustPolicy = {
    deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId,
    trustRevision: "fixture-policy-r1",
    expectedPeerId: "audit-gateway-01",
    pinnedPublicKeyPem: publicKeyPem, pinnedSpkiSha256: spkiSha256,
    minimum: {
      ...expectedAnchor, manifestSha256: digest,
      checkpointSequence: 1, eventSha256: headHash
    }
  };
  let remoteSequence = 1;
  let remoteHash = headHash;
  let remotePeerId = "audit-gateway-01";
  let remoteSigningKey = keys.privateKey;
  let claimedAuthenticated = true;
  let reads = 0;
  const channel: Day94GatewayPinnedChannel = {
    async inspectPeer() {
      return {peerId: remotePeerId, transportAuthenticated: true};
    },
    async fetchLatest(req: Day94AuditGatewayRequest): Promise<Day94SignedGatewayReply> {
      reads += 1;
      const reply: Day94AuditGatewayPayload = {
        domain: DAY94_AUDIT_GATEWAY_DOMAIN,
        deploymentId: scope.deploymentId, releaseId: scope.releaseId,
        attemptId: scope.attemptId, challengeHex: req.challengeHex,
        issuedAtEpochMs: now - 500, expiresAtEpochMs: now + 30_000,
        eventSha256: remoteHash,
        checkpoint: {
          domain: DAY93_AUDIT_ANCHOR_DOMAIN,
          deploymentId: scope.deploymentId, releaseId: scope.releaseId,
          attemptId: scope.attemptId, ...expectedAnchor,
          manifestSha256: digest,
          freezeVersion: remoteSequence,
          state: remoteSequence === 1 ? "frozen" : "invalidated",
          checkpointSequence: remoteSequence,
          recordedAtEpochMs: now - 1000,
          expiresAtEpochMs: now + 30_000
        }
      };
      return {
        payload: reply,
        signatureBase64: btoa(String.fromCharCode(...sign(null,
          encodeDay94GatewayPayload(reply), remoteSigningKey))),
        claimedPeerId: "audit-gateway-01", claimedAuthenticated
      };
    }
  };
  const active: Day95LifecyclePolicy = { ...policy, policyEpoch: 7, keyState: "active",
    notBeforeEpochMs: now - 2000, expiresAtEpochMs: now + 30_000, revokedSpkiSha256: [] };
  const revoked: Day95LifecyclePolicy = { ...active, policyEpoch: 8, keyState: "revoked",
    revokedSpkiSha256: [active.pinnedSpkiSha256] };
  const rotated: Day95LifecyclePolicy = { ...active, policyEpoch: 8, trustRevision: "fixture-policy-r2",
    pinnedPublicKeyPem: wrong.publicKey,
    pinnedSpkiSha256: createHash("sha256").update(createPublicKey(wrong.publicKey)
      .export({ type: "spki", format: "der" })).digest("hex"),
    revokedSpkiSha256: [active.pinnedSpkiSha256] };
  let policyReads = 0;
  const base: Day95LifecycleReleaseInput = {
    intent: "isolated_review", scope, expectedAnchor, nowEpochMs: now,
    store: inventory, expectedFreezeVersion: 1, expectedFreezeSha256: digest,
    inventoryAdapter: { async readSnapshot() { return snapshot; } },
    hostReceipts: [], consumerAck: null, auditReader: audit,
    baseline: active, clock: () => now, channel,
    lifecycleReader: { async readPolicy() { policyReads++; return active; } }
  };


  const controller = new SQLiteDay97ControllerLab(join(dir,"controller.sqlite"));
  const resource = new SQLiteDay97ResourceLab(join(dir,"resource.sqlite"));
  try {
    const d = scope.deploymentId, b = "barrier-1";
    const old = (resourceId: string) => ({deploymentId:d,resourceId,requestId:"old-1",
      principal:"old-worker",fence:41,command:"dummy"});
    const barrier: Day97BarrierPlan = {intent:"isolated_lab",deploymentId:d,
      releaseId:scope.releaseId,attemptId:scope.attemptId,barrierId:b,policyEpoch:8,
      policySha256:hash("policy-8"),targets:[{resourceId:"A",floor:42},{resourceId:"B",floor:42}]};
    resource.seed(old("A"),7); resource.seed(old("B"),7);
    assert.equal(controller.begin(barrier,null).status,"revocation_pending");
    const commands=controller.pending(d,b);
    assert.equal(commands.length,2);
    const observe = (): Day97BarrierObservation => {
      const pending=new Set(controller.pending(d,b).map(c=>c.resourceId));
      return {scope,barrierId:b,expectedResourceIds:commands.map(c=>c.resourceId),
        targets:commands.map(c=>({resourceId:c.resourceId,expectedFloor:c.floor,
          expectedCommandSha256:c.commandSha256,ackRecorded:!pending.has(c.resourceId),
          head:resource.head(d,c.resourceId),oldEffectCount:resource.effectCount(d,c.resourceId)}))};
    };
    const check = (r: Awaited<ReturnType<typeof review>>, reason: string) => {
      assert.equal(r.barrierReason,reason); assert.equal(r.barrierObservationTrusted,false);
      assert.equal(r.publishAuthorized,false); assert.equal(r.action,"hold");
      assert.equal(r.authenticatedEvidenceCount,0); assert.equal(r.authenticatedExternalAnchorCount,0);
      assert.ok(r.blockers.includes("remote_revocation_confirmation_unverified"));
      assert.ok(r.blockers.includes("remote_resource_fence_enforcement_unverified"));
    };
    check(await review(base),"barrier_observation_missing");
    const a=resource.install(commands[0],"isolated_lab");
    assert.equal(resource.write(old("A"),"isolated_lab").status,"stale_fence");
    assert.equal(resource.write(old("B"),"isolated_lab").status,"effect_committed_fixture");
    const lost=await review(base,observe());
    check(lost,"fixture_barrier_pending"); assert.equal(lost.ackedTargets,0);
    assert.equal(lost.matchingHeads,1); assert.equal(lost.oldEffectsObserved,true);
    assert.equal(controller.pending(d,b).length,2); // reviewer did not record ACK
    const retry=resource.install(commands[0],"isolated_lab");
    assert.deepEqual(retry.ack,a.ack);
    controller.recordAck(retry.ack!);
    check(await review(base,observe()),"fixture_barrier_pending");
    const bb=resource.install(commands[1],"isolated_lab");
    controller.recordAck(bb.ack!);
    const heads=[resource.head(d,"A")!,resource.head(d,"B")!];
    assert.equal(controller.confirm(d,b,heads).status,"fixture_revocation_confirmed");
    const all=observe();
    const complete=await review(base,all);
    check(complete,"fixture_barrier_all_targets_match_not_authority");
    assert.equal(complete.ackedTargets,2); assert.equal(complete.matchingHeads,2);
    assert.ok(complete.blockers.includes("fixture_old_effect_reconciliation_required"));
    assert.equal(resource.effectCount(d,"B"),1);
    assert.equal(resource.write(old("B"),"isolated_lab").status,"exact_effect_replay");
    const stale={...all,targets:all.targets.map((t,i)=>i===0?{...t,head:{...heads[0],floor:43}}:t)};
    check(await review(base,stale),"fixture_barrier_head_conflict");
    check(await review(base,{...all,targets:[all.targets[0],all.targets[0]]}),"barrier_inventory_conflict");
    check(await review(base,{...all,scope:{...scope,attemptId:"other"}}),"barrier_scope_mismatch");
    check(await review(base,{...all,targets:all.targets.map(t=>({...t,oldEffectCount:-1}))}),"barrier_observation_invalid");
    // Fabricated complete snapshots cannot clear source blockers.
    check(await review(base,{...all,targets:all.targets.map(t=>({...t,oldEffectCount:0}))}),
      "fixture_barrier_all_targets_match_not_authority");
    let raceReads=0;
    const raced=await review({...base,lifecycleReader:{async readPolicy(){return raceReads++===0?active:revoked;}}},all);
    check(raced,"fixture_barrier_all_targets_match_not_authority");
    assert.equal(raced.lifecycleReason,"policy_changed_during_review");
    const noAudit=await review({...base,auditReader:null},all);
    assert.equal(noAudit.auditReason,"audit_anchor_reader_unavailable");
    const before=reads, beforePolicy=policyReads;
    const unreadable={...all,get scope(): Day97BarrierObservation["scope"] {throw new Error("must not inspect production observation");}};
    check(await review({...base,intent:"production_release"},unreadable),"barrier_not_evaluated");
    assert.equal(reads,before); assert.equal(policyReads,beforePolicy);
    console.log("Day 97 evening: revocation observations never authorize release (NO_GO).");
  } finally { controller.close(); resource.close(); }
} finally { audit.close(); inventory.close(); rmSync(dir,{recursive:true,force:true}); }
