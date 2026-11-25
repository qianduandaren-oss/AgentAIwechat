import { reviewDay96AtomicReleaseBoundary } from "../runtime/recovery-writer-atomic-authorization-release-boundary.js";
import { SQLiteDay96AtomicAuthorizationLab, day96LabSha256,
  type Day96LabPolicy, type Day96IssueRequest, type Day96ConsumeRequest
} from "../runtime/recovery-writer-atomic-authorization-fence-lab.js";
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

const dir = mkdtempSync(join(tmpdir(), "day96-evening-composite-"));
const now = Date.UTC(2026, 10, 25, 10, 0, 0);
const scope = {
  deploymentId: "staging:day96-evening",
  releaseId: "release-96", attemptId: "attempt-96-evening",
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

  const labPath = join(dir, "fence.sqlite");
  const controller = new SQLiteDay96AtomicAuthorizationLab(labPath, () => now);
  const resource = new SQLiteDay96AtomicAuthorizationLab(labPath, () => now);
  const hash = day96LabSha256;
  const labPolicy = (resourceId: string): Day96LabPolicy => ({
    deploymentId: scope.deploymentId, releaseId: scope.releaseId, attemptId: scope.attemptId,
    resourceId, policyEpoch: 7, policySha256: hash("fixture-policy"),
    keySpkiSha256: spkiSha256, keyActive: true, notBeforeEpochMs: now - 2000,
    policyExpiresAtEpochMs: now + 30_000, checkpointSequence: 1, eventSha256: headHash,
    evidenceSha256: hash("synthetic-evidence"), evidenceExpiresAtEpochMs: now + 20_000
  });
  const issue = (expected: Day96LabPolicy): Day96IssueRequest => ({
    intent: "isolated_lab", expected, requestId: "req-1", principal: "worker-A",
    operation: "dummy_write", commandSha256: hash("dummy"), expiresAtEpochMs: now + 5000
  });
  const consume = (p: Day96LabPolicy): Day96ConsumeRequest => ({
    deploymentId: p.deploymentId, releaseId: p.releaseId, attemptId: p.attemptId,
    resourceId: p.resourceId, requestId: "req-1", principal: "worker-A",
    operation: "dummy_write", command: "dummy", fence: 1, intent: "isolated_lab"
  });
  function check(r: Awaited<ReturnType<typeof reviewDay96AtomicReleaseBoundary>>, reason: string) {
    assert.equal(r.action, "hold");
    assert.equal(r.publishAuthorized, false);
    assert.equal(r.authenticatedEvidenceCount, 0);
    assert.equal(r.authenticatedExternalAnchorCount, 0);
    assert.equal(r.labObservationTrusted, false);
    assert.equal(r.labReason, reason);
    assert.ok(r.blockers.includes("atomic_policy_epoch_authorization_not_implemented"));
    assert.ok(r.blockers.includes("remote_resource_fence_enforcement_unverified"));
  }
  try {
    const stale = labPolicy("stale");
    assert.equal(controller.initialize(stale).status, "initialized");
    const missing = await reviewDay96AtomicReleaseBoundary(base);
    check(missing, "lab_observation_missing");
    assert.equal(reads, 1); assert.equal(policyReads, 2);
    assert.equal(missing.requiredHostCheckSlots, 28);
    assert.equal(missing.requiredSourceTasks, 30);
    assert.equal(resource.effectCount(stale.resourceId), 0);
    // Review did not allocate a capability; first real isolated issue is fence=1.
    assert.equal(controller.issue(issue(stale)).fence, 1);
    assert.equal(controller.revoke(stale).fence, 2);
    const rejected = resource.consume(consume(stale));
    assert.equal(rejected.status, "stale_fence");
    const staleObservation = { scope: stale, status: rejected.status,
      effectCount: resource.effectCount(stale.resourceId) };
    assert.equal(staleObservation.effectCount, 0);
    let raceReads = 0;
    const raced = await reviewDay96AtomicReleaseBoundary({ ...base,
      lifecycleReader: { async readPolicy() { return raceReads++ === 0 ? active : revoked; } }
    }, staleObservation);
    check(raced, "fixture_stale_fence_not_authority");
    assert.equal(raced.lifecycleReason, "policy_changed_during_review");
    assert.equal(raced.signatureVerified, true);

    const normal = labPolicy("normal");
    controller.initialize(normal);
    assert.equal(controller.issue(issue(normal)).status, "issued");
    const committed = resource.consume(consume(normal));
    assert.equal(committed.status, "effect_committed");
    const observation = { scope: normal, status: committed.status,
      effectCount: resource.effectCount(normal.resourceId) };
    const result = await reviewDay96AtomicReleaseBoundary(base, observation);
    check(result, "fixture_effect_committed_not_authority");
    assert.equal(result.labEffectCount, 1);
    assert.equal(result.signatureVerified, true);
    assert.equal(result.auditReason, "checkpoint_candidate_consistent_but_source_unverified");
    assert.equal(resource.effectCount(normal.resourceId), 1);
    assert.equal(controller.revoke(normal).status, "revoked");
    const replay = resource.consume(consume(normal));
    assert.equal(replay.status, "exact_effect_replay");
    assert.deepEqual(replay.receipt, committed.receipt);
    const historical = await reviewDay96AtomicReleaseBoundary({ ...base, auditReader: null },
      { ...observation, status: replay.status });
    check(historical, "fixture_exact_effect_replay_not_authority");
    assert.equal(historical.auditReason, "audit_anchor_reader_unavailable");
    assert.equal(resource.effectCount(normal.resourceId), 1);
    check(await reviewDay96AtomicReleaseBoundary(base, { ...observation,
      scope: { ...normal, attemptId: "different" } }), "lab_observation_scope_mismatch");
    check(await reviewDay96AtomicReleaseBoundary(base, { ...observation, effectCount: 2 }),
      "lab_observation_inconsistent_or_unsupported");
    // Even a fabricated positive label can only affect diagnostics, never authorization.
    check(await reviewDay96AtomicReleaseBoundary(base, { scope: labPolicy("never-initialized"),
      status: "effect_committed", effectCount: 1 }), "fixture_effect_committed_not_authority");
    const beforeReads = reads, beforePolicyReads = policyReads;
    const production = await reviewDay96AtomicReleaseBoundary({ ...base,
      intent: "production_release" }, observation);
    check(production, "lab_not_evaluated");
    assert.equal(reads, beforeReads);
    assert.equal(policyReads, beforePolicyReads);
    assert.equal(resource.effectCount(normal.resourceId), 1);
    console.log("Day 96 evening: lab fencing observations never promote release authority.");
  } finally { resource.close(); controller.close(); }
} finally {
  audit.close();
  inventory.close();
  rmSync(dir, { recursive: true, force: true });
}
