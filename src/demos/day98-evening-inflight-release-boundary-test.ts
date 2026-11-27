import { reviewDay98InflightReleaseBoundary as review98 } from "../runtime/recovery-writer-inflight-release-boundary.js";
import type { Day98InflightRow, Day98InflightIntent, Day98InstallObservation } from "../runtime/recovery-writer-inflight-effect-reconciliation.js";
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

const dir = mkdtempSync(join(tmpdir(), "day98-evening-composite-"));
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
    const target = all.targets.find(t => t.resourceId === "B")!;
    const intent: Day98InflightIntent = { ...scope, barrierId:b, resourceId:"B",
      providerId:"video", commandId:"cmd", effectId:"effect", idempotencyKey:"key",
      originalFence:41, targetFloor:target.expectedFloor,
      commandSha256:hash("dummy"), barrierCommandSha256:target.expectedCommandSha256 };
    // Ordinals are synthetic: Day 97 SQLite does not persist this resource journal.
    const install: Day98InstallObservation = { ...intent, floor:target.expectedFloor,
      commandSha256:target.expectedCommandSha256, journalId:"B-journal", installOrdinal:105 };
    const applied = {kind:"applied",binding:{...intent},receiptId:"receipt",
      journalId:"B-journal",commitOrdinal:104} as const;
    const row: Day98InflightRow = {intent,install,observations:[applied]};
    const run = async (rows?: readonly Day98InflightRow[], barrier = all) => {
      const result = await review98(base,barrier,rows);
      assert.equal(result.action,"hold"); assert.equal(result.publishAuthorized,false);
      assert.equal(result.automaticResend,false); assert.equal(result.inflightInventoryTrusted,false);
      assert.equal(result.authenticatedEvidenceCount,0);
      assert.ok(result.blockers.includes("remote_revocation_confirmation_unverified"));
      assert.ok(result.blockers.includes("inflight_provider_receipts_unverified"));
      return result;
    };
    const complete = await run([row]);
    assert.equal(complete.historicalApplied,1);
    assert.equal(complete.candidateOldEffectCountMismatch,false);
    assert.ok(complete.blockers.includes("fixture_old_effect_reconciliation_required"));
    assert.equal((await run()).inflightReason,"inventory_missing_or_empty");
    const unresolved = await run([{...row,observations:[]}]);
    assert.equal(unresolved.unresolved,1);
    assert.ok(unresolved.blockers.includes("fixture_inflight_outcome_unresolved"));
    assert.ok(unresolved.blockers.includes("fixture_old_effect_count_mismatch"));
    const negative = await run([{...row,observations:[{kind:"not_applied",binding:intent,
      final:true,noLateCommitGuarantee:true}]}]);
    assert.equal(negative.finalNotApplied,1);
    assert.equal(negative.candidateOldEffectCountMismatch,true);
    const late = await run([{...row,observations:[{...applied,commitOrdinal:106}]}]);
    assert.equal(late.invariantViolations,1);
    assert.ok(late.blockers.includes("fixture_inflight_invariant_violation"));
    const unordered = await run([{...row,observations:[{...applied,journalId:"other"}]}]);
    assert.equal(unordered.unresolved,1); assert.equal(unordered.appliedObserved,1);
    assert.equal((await run([{...row,intent:{...intent,attemptId:"other"}}])).inflightReason,
      "inflight_barrier_binding_conflict");
    assert.equal((await run([{...row,intent:{...intent,resourceId:"C"}}])).inflightReason,
      "inflight_barrier_binding_conflict");
    assert.equal((await run([{...row,intent:{...intent,targetFloor:43}}])).inflightReason,
      "inflight_barrier_binding_conflict");
    assert.equal((await run([row,row])).inflightReason,"inventory_identity_conflict");
    const pending = await run([row],{...all,targets:all.targets.map(t=>({...t,ackRecorded:false}))});
    assert.equal(pending.barrierReason,"fixture_barrier_pending");
    assert.equal(pending.historicalApplied,1);
    assert.equal((await review98(base,undefined,[row])).inflightReason,"inflight_barrier_unavailable");
    const noAudit = await review98({...base,auditReader:null},all,[row]);
    assert.equal(noAudit.auditReason,"audit_anchor_reader_unavailable");
    let raceReads=0;
    const raced=await review98({...base,lifecycleReader:{async readPolicy(){return raceReads++===0?active:revoked;}}},all,[row]);
    assert.equal(raced.lifecycleReason,"policy_changed_during_review");
    let inspected=0;
    const forbidden = new Proxy([] as Day98InflightRow[],{get(){inspected++;throw Error("production read");}});
    const before=reads, beforePolicy=policyReads;
    const production=await review98({...base,intent:"production_release"},all,forbidden);
    assert.equal(production.inflightReason,"inflight_not_evaluated");
    assert.equal(production.publishAuthorized,false);
    assert.equal(inspected,0); assert.equal(reads,before); assert.equal(policyReads,beforePolicy);
    assert.equal(resource.effectCount(d,"B"),1);
    console.log("Day 98 evening: candidate reconciliation retains HOLD (NO_GO)");
  } finally { controller.close(); resource.close(); }
} finally { audit.close(); inventory.close(); rmSync(dir,{recursive:true,force:true}); }
