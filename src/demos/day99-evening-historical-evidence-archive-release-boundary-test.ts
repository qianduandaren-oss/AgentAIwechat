import { reviewDay99HistoricalEvidenceArchiveReleaseBoundary as review99, type Day99ArchiveRecord, type Day99ArchiveSnapshot } from "../runtime/recovery-writer-historical-evidence-archive-release-boundary.js";
import { SQLiteDay99HistoricalEvidenceArchiveLab, type Day99ArchiveRequest, type Day99FrozenIntent } from "../runtime/recovery-writer-historical-evidence-archive-lab.js";
import { DatabaseSync } from "node:sqlite";
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

const dir = mkdtempSync(join(tmpdir(), "day99-evening-composite-"));
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
    const path=join(dir,"archive.sqlite");
    const archive=new SQLiteDay99HistoricalEvidenceArchiveLab(path);
    const inspect=new DatabaseSync(path);
    try {
      const frozen:Day99FrozenIntent={tenantId:"t",runId:"run",originalActor:"worker-A",intent};
      archive.seedFrozen(frozen);
      assert.equal(archive.setGrant("t","run",intent.effectId,"reconciler-B",0,true),true);
      const q:Day99ArchiveRequest={mode:"isolated_lab",tenantId:"t",runId:"run",
        effectId:intent.effectId,expectedRevision:1,operation:"archive_historical_evidence",
        evidenceId:"e1",observation:applied};
      const snapshotArchive=():Day99ArchiveSnapshot=>({tenantId:"t",runId:"run",frozen:[frozen],
        records:inspect.prepare(`SELECT tenant AS tenantId,run AS runId,effect AS effectId,
          provider AS providerId,evidence_id AS evidenceId,archive_id AS archiveId,
          original_actor AS originalActor,archived_by AS archivedBy,revision,
          canonical_json AS canonicalJson,digest,source FROM day99_lab_evidence ORDER BY evidence_id`)
          .all() as unknown as Day99ArchiveRecord[]});
      const run=async(s?:Day99ArchiveSnapshot,rows:readonly Day98InflightRow[]=[row])=>{
        const v=await review99(base,all,rows,s);
        assert.equal(v.action,"hold");assert.equal(v.publishAuthorized,false);
        assert.equal(v.automaticResend,false);assert.equal(v.archiveObservationTrusted,false);
        assert.equal(v.authenticatedEvidenceCount,0);
        assert.ok(v.blockers.includes("remote_revocation_confirmation_unverified"));
        assert.ok(v.blockers.includes("inflight_provider_receipts_unverified"));
        assert.ok(v.blockers.includes("archive_candidate_provenance_unverified"));
        return v;
      };
      assert.equal((await run()).archiveReason,"archive_snapshot_missing");
      assert.equal((await run(snapshotArchive())).missingTerminalCandidates,1);
      assert.equal(archive.archive("reconciler-B",q).status,"candidate_archived");
      const saved=snapshotArchive();
      const matched=await run(saved);
      assert.equal(matched.archiveReason,"fixture_archive_matches_not_authority");
      assert.equal(matched.archiveRecordCount,1);
      assert.equal(matched.historicalApplied,1);
      assert.equal(matched.missingTerminalCandidates,0);
      assert.equal(matched.unexpectedArchiveCandidates,0);
      const rec=saved.records[0];
      assert.equal((await run({...saved,records:[{...rec,digest:hash("tampered")}]})).archiveReason,
        "archive_digest_or_encoding_conflict");
      assert.equal((await run({...saved,records:[{...rec,originalActor:"other"}]})).archiveReason,
        "archive_scope_or_inventory_conflict");
      assert.equal((await run({...saved,records:[{...rec,tenantId:"other"}]})).archiveReason,
        "archive_scope_or_inventory_conflict");
      assert.equal((await run({...saved,records:[rec,rec]})).archiveReason,"archive_duplicate_evidence_identity");
      assert.equal((await run(saved,[{...row,observations:[]}])).unexpectedArchiveCandidates,1);
      const negative={kind:"not_applied",binding:intent,final:true,noLateCommitGuarantee:true} as const;
      assert.equal(archive.archive("reconciler-B",{...q,evidenceId:"e2",observation:negative}).status,"candidate_archived");
      const conflict=await run(snapshotArchive(),[{...row,observations:[applied,negative]}]);
      assert.equal(conflict.archiveReason,"fixture_archive_distinct_terminal_candidates");
      assert.equal(conflict.conflictingEffects,1);
      assert.equal(conflict.invariantViolations,1);
      assert.equal(archive.setGrant("t","run",intent.effectId,"reconciler-B",1,false),true);
      assert.equal(archive.archive("reconciler-B",q).status,"permission_denied");
      // Internal candidate snapshot still exists; this is not a read entitlement for the revoked actor.
      assert.equal((await run(snapshotArchive())).archiveRecordCount,2);
      const noAudit=await review99({...base,auditReader:null},all,[row],saved);
      assert.equal(noAudit.auditReason,"audit_anchor_reader_unavailable");
      let raceReads=0;
      const raced=await review99({...base,lifecycleReader:{async readPolicy(){return raceReads++===0?active:revoked;}}},all,[row],saved);
      assert.equal(raced.lifecycleReason,"policy_changed_during_review");
      let inspected=0;
      const forbidden=new Proxy(saved,{get(){inspected++;throw Error("production read");}});
      const before=reads,beforePolicy=policyReads;
      const prod=await review99({...base,intent:"production_release"},all,[row],forbidden);
      assert.equal(prod.archiveReason,"archive_not_evaluated");
      assert.equal(prod.publishAuthorized,false);
      assert.equal(inspected,0);assert.equal(reads,before);assert.equal(policyReads,beforePolicy);
      assert.equal(snapshotArchive().records.length,2);
      assert.equal(resource.effectCount(d,"B"),1);
      const auditCount=inspect.prepare("SELECT COUNT(*) AS n FROM day99_lab_audit").get() as {n:number};
      assert.equal(auditCount.n,2);
      console.log("Day 99 evening: candidate archive diagnostics retain HOLD (NO_GO)");
    } finally {inspect.close();archive.close();}
  } finally {controller.close();resource.close();}
} finally {audit.close();inventory.close();rmSync(dir,{recursive:true,force:true});}
