import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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
  reviewDay94GatewayReleaseBoundary,
  type Day94GatewayReleaseBoundaryInput
} from "../runtime/recovery-writer-audit-gateway-release-boundary.js";
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

const dir = mkdtempSync(join(tmpdir(), "day94-evening-composite-"));
const now = Date.UTC(2026, 10, 23, 10, 0, 0);
const scope = {
  deploymentId: "staging:day94-evening",
  releaseId: "release-94", attemptId: "attempt-94-evening",
  expectedHosts: [
    { hostId: "host-A", mountNamespaceId: "mnt:[1001]" },
    { hostId: "host-B", mountNamespaceId: "mnt:[1002]" }
  ]
};
const expectedAnchor = { snapshotId: "fixture-snapshot-94", revision: "r1" };
const snapshot: Day91InventorySnapshot = {
  ...scope, ...expectedAnchor, hosts: scope.expectedHosts,
  capturedAtEpochMs: now - 2000, expiresAtEpochMs: now + 60_000
};
const inventory = new SQLiteDay92InventoryFreezeStore(join(dir, "freeze.sqlite"));
const audit = new SQLiteDay93AuditCheckpointStore(join(dir, "audit.sqlite"));
const keys = generateKeyPairSync("ed25519");
const wrong = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const spkiSha256 = createHash("sha256")
  .update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");

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
        signatureBase64: sign(null, encodeDay94GatewayPayload(reply),
          remoteSigningKey).toString("base64"),
        claimedPeerId: "audit-gateway-01", claimedAuthenticated
      };
    }
  };
  const base: Day94GatewayReleaseBoundaryInput = {
    intent: "isolated_review", scope, expectedAnchor, nowEpochMs: now,
    store: inventory, expectedFreezeVersion: 1,
    expectedFreezeSha256: digest,
    inventoryAdapter: { async readSnapshot() { return snapshot; } },
    hostReceipts: [], consumerAck: null, auditReader: audit,
    policyReader: { async readPolicy() { return policy; } },
    channel
  };
  const assertHold = (x: Awaited<ReturnType<typeof reviewDay94GatewayReleaseBoundary>>) => {
    assert.equal(x.action, "hold");
    assert.equal(x.publishAuthorized, false);
    assert.equal(x.authenticatedExternalAnchorCount, 0);
    assert.equal(x.authenticatedEvidenceCount, 0);
    assert.ok(x.blockers.includes("production_release_not_authorized"));
    assert.ok(x.blockers.includes("latest_external_monotonic_head_and_revocation_unproven"));
  };
  // Baseline: local freeze, local audit and signed pinned gateway all match.
  const baseline = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(baseline);
  assert.equal(baseline.gatewayReason,
    "fixture_gateway_identity_and_head_match_but_authority_unproven");
  assert.equal(baseline.auditReason,
    "checkpoint_candidate_consistent_but_source_unverified");
  assert.equal(baseline.freezeReason,
    "fixture_freeze_consistent_but_source_unverified");
  assert.equal(baseline.gatewaySignatureVerifiedAgainstConfiguredPin, true);
  assert.equal(baseline.gatewayPeerMatchedInFixture, true);
  assert.equal(baseline.requiredHostCheckSlots, 28);
  assert.equal(baseline.requiredSourceTasks, 30);
  assert.ok(baseline.evidenceChainReasons.some(r => r.includes("consumer_ack_missing")));

  // Even 28 synthetic PASS rows plus a claimed authenticated Consumer ACK
  // never bridge source verification or grant a publish capability.
  const syntheticReceipts = listRequiredCutoverEvidence(scope).map((item, i) => ({
    ...item, deploymentId: scope.deploymentId, releaseId: scope.releaseId,
    attemptId: scope.attemptId,
    status: "pass" as const,
    observerKind: "independent_host_probe" as const,
    observerId: "untrusted-label",
    observedAtEpochMs: now - (item.phase === "preflight" ? 1800 : 800),
    artifactSha256: String(i % 10).repeat(64)
  }));
  const synthetic = await reviewDay94GatewayReleaseBoundary({
    ...base, hostReceipts: syntheticReceipts,
    consumerAck: {
      deploymentId: scope.deploymentId, releaseId: scope.releaseId,
      attemptId: scope.attemptId,
      consumerId: "consumer-fixture", rawIngressClosed: true,
      claimedAuthenticated: true, receivedAtEpochMs: now - 200
    }
  });
  assertHold(synthetic);
  assert.equal(synthetic.gatewaySignatureVerifiedAgainstConfiguredPin, true);
  assert.ok(synthetic.evidenceChainReasons.some(r =>
    r.includes("consumer_ack_candidate_unverified")));
  assert.ok(synthetic.evidenceChainReasons.some(r =>
    r.includes("host_coverage_only_metadata_unverified")));

  // All signatures still validate: a re-signed old head must be refused
  // against a minimum pin of sequence 2.
  const policyWithHigherPin: Day94GatewayTrustPolicy = {
    ...policy, minimum: { ...policy.minimum,
      checkpointSequence: 2, eventSha256: "c".repeat(64) }
  };
  const rollback = await reviewDay94GatewayReleaseBoundary({
    ...base, policyReader: {
      async readPolicy() { return policyWithHigherPin; }
    }
  });
  assertHold(rollback);
  assert.equal(rollback.gatewayReason,
    "gateway_checkpoint_below_pinned_high_watermark");
  assert.equal(rollback.gatewaySignatureVerifiedAgainstConfiguredPin, true);

  // A new event with the same sequence but a different hash is a fork.
  remoteHash = "d".repeat(64);
  const fork = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(fork);
  assert.equal(fork.gatewayReason, "gateway_checkpoint_same_sequence_event_conflict");
  remoteHash = headHash;

  remoteSequence = 2;
  remoteHash = "e".repeat(64);
  const ahead = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(ahead);
  assert.equal(ahead.gatewayReason,
    "gateway_checkpoint_above_pinned_minimum_unverified");
  remoteSequence = 1;
  remoteHash = headHash;

  // JSON-claimed identity is ignored; the separately observed fixture peer wins.
  claimedAuthenticated = false;
  const forgedClaim = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(forgedClaim);
  assert.equal(forgedClaim.gatewayPeerMatchedInFixture, true);
  claimedAuthenticated = true;
  remotePeerId = "other-peer";
  const peer = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(peer);
  assert.equal(peer.gatewayReason, "gateway_peer_identity_mismatch");
  remotePeerId = "audit-gateway-01";

  remoteSigningKey = wrong.privateKey;
  const badSig = await reviewDay94GatewayReleaseBoundary(base);
  assertHold(badSig);
  assert.equal(badSig.gatewayReason, "gateway_signature_invalid");
  remoteSigningKey = keys.privateKey;

  const missingAudit = await reviewDay94GatewayReleaseBoundary({
    ...base, auditReader: null
  });
  assertHold(missingAudit);
  assert.equal(missingAudit.auditReason, "audit_anchor_reader_unavailable");

  const drift = await reviewDay94GatewayReleaseBoundary({
    ...base, inventoryAdapter: {
      async readSnapshot() { return { ...snapshot, revision: "r2" }; }
    }
  });
  assertHold(drift);
  assert.ok(drift.evidenceChainReasons.some(r =>
    r.includes("inventory_snapshot_anchor_mismatch")));

  const beforeProdReads = reads;
  const prod = await reviewDay94GatewayReleaseBoundary({
    ...base, intent: "production_release"
  });
  assertHold(prod);
  assert.equal(prod.gatewayReason, "production_release_not_authorized");
  assert.equal(reads, beforeProdReads, "production must never query gateway");

  console.log("Day 94 evening: signed fixture head, 28 synthetic PASS and ACK all HOLD.");
  console.log("Rollback, same-sequence fork, missing audit, peer mismatch, bad signature HOLD.");
  console.log("No external trusted latest head, independent Host/FD census, ACK or GO capability.");
} finally {
  audit.close();
  inventory.close();
  rmSync(dir, { recursive: true, force: true });
}
