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

const dir = mkdtempSync(join(tmpdir(), "day95-evening-composite-"));
const now = Date.UTC(2026, 10, 24, 10, 0, 0);
const scope = {
  deploymentId: "staging:day95-evening",
  releaseId: "release-95", attemptId: "attempt-95-evening",
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
  async function expectHold(cfg: Day95LifecycleReleaseInput, reason: string, verified: boolean) {
    const r = await reviewDay95LifecycleReleaseBoundary(cfg);
    assert.equal(r.lifecycleReason, reason);
    assert.equal(r.signatureVerified, verified);
    assert.equal(r.action, "hold");
    assert.equal(r.publishAuthorized, false);
    assert.equal(r.authenticatedExternalAnchorCount, 0);
    assert.equal(r.authenticatedEvidenceCount, 0);
    assert.ok(r.blockers.includes("atomic_policy_epoch_authorization_not_implemented"));
    assert.ok(r.blockers.includes("production_release_not_authorized"));
    return r;
  }
  const consistent = "fixture_lifecycle_consistent_authority_unproven";
  const normal = await expectHold(base, consistent, true);
  assert.equal(reads, 1);
  assert.equal(policyReads, 2);
  assert.equal(normal.requiredHostCheckSlots, 28);
  assert.equal(normal.requiredSourceTasks, 30);
  assert.equal(normal.auditReason, "checkpoint_candidate_consistent_but_source_unverified");
  assert.equal(normal.freezeReason, "fixture_freeze_consistent_but_source_unverified");
  const syntheticReceipts = listRequiredCutoverEvidence(scope).map((item, i) => ({
    ...item, deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId, status: "pass" as const,
    observerKind: "independent_host_probe" as const, observerId: "untrusted-label",
    observedAtEpochMs: now - (item.phase === "preflight" ? 1800 : 800),
    artifactSha256: String(i % 10).repeat(64)
  }));
  const synthetic = await expectHold({ ...base, hostReceipts: syntheticReceipts,
    consumerAck: { deploymentId: scope.deploymentId, releaseId: scope.releaseId,
      attemptId: scope.attemptId, consumerId: "consumer-fixture", rawIngressClosed: true,
      claimedAuthenticated: true, receivedAtEpochMs: now - 200 }
  }, consistent, true);
  assert.ok(synthetic.evidenceChainReasons.some(r => r.includes("consumer_ack_candidate_unverified")));
  assert.ok(synthetic.evidenceChainReasons.some(r => r.includes("host_coverage_only_metadata_unverified")));
  let raceReads = 0;
  await expectHold({ ...base, lifecycleReader: {
    async readPolicy() { return raceReads++ === 0 ? active : revoked; }
  } }, "policy_changed_during_review", true);
  const beforeRevoked = reads;
  await expectHold({ ...base, baseline: revoked, lifecycleReader: {
    async readPolicy() { return revoked; }
  } }, "policy_key_not_active", false);
  assert.equal(reads, beforeRevoked);
  await expectHold({ ...base, baseline: rotated, lifecycleReader: {
    async readPolicy() { return active; }
  } }, "policy_epoch_rollback", false);
  // A rotated policy cannot accept signatures made by the old key.
  await expectHold({ ...base, lifecycleReader: {
    async readPolicy() { return rotated; }
  } }, "gateway_signature_invalid", false);
  remoteSigningKey = wrong.privateKey;
  await expectHold({ ...base, lifecycleReader: {
    async readPolicy() { return rotated; }
  } }, consistent, true);
  remoteSigningKey = keys.privateKey;
  // Missing audit must remain visible despite a successful lifecycle check.
  const missing = await expectHold({ ...base, auditReader: null }, consistent, true);
  assert.equal(missing.auditReason, "audit_anchor_reader_unavailable");
  await expectHold({ ...base, lifecycleReader: {
    async readPolicy() { throw Error("offline"); }
  } }, "policy_or_gateway_review_failed", false);
  // A stable but stale policy reader can still appear consistent: no authority granted.
  let actualPolicy = active;
  const stale = await expectHold({ ...base, lifecycleReader: {
    async readPolicy() { actualPolicy = revoked; return active; }
  } }, consistent, true);
  assert.equal(actualPolicy.policyEpoch, 8);
  assert.equal(stale.policyEpoch, 7);
  const beforeProd = reads, beforePolicy = policyReads;
  let inventoryCalls = 0;
  await expectHold({ ...base, intent: "production_release",
    inventoryAdapter: { async readSnapshot() { inventoryCalls++; return snapshot; } }
  }, "production_release_not_authorized", false);
  assert.equal(reads, beforeProd);
  assert.equal(policyReads, beforePolicy);
  assert.equal(inventoryCalls, 0);
  console.log("Day 95 evening: lifecycle, source blockers and stale-policy counterexample HOLD.");
} finally {
  audit.close();
  inventory.close();
  rmSync(dir, { recursive: true, force: true });
}
