import { strict as assert } from "node:assert";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import {
  DAY94_AUDIT_GATEWAY_DOMAIN, encodeDay94GatewayPayload,
  type Day94AuditGatewayRequest, type Day94AuditGatewayPayload,
  type Day94SignedGatewayReply
} from "../runtime/recovery-writer-audit-gateway-contract.js";
import { DAY93_AUDIT_ANCHOR_DOMAIN } from
  "../runtime/recovery-writer-inventory-audit-anchor.js";
import {
  reviewDay94PinnedGatewayWatermark,
  type Day94GatewayTrustPolicy, type Day94GatewayPinnedChannel,
  type Day94GatewayPinnedReviewInput
} from "../runtime/recovery-writer-audit-gateway-pinned-watermark.js";

const now = Date.UTC(2026, 10, 24, 4, 0);
const scope = {
  deploymentId: "staging:day95", releaseId: "release-95",
  attemptId: "attempt-95-01"
};
const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const wrongKeys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const pem = keys.publicKey;
const spkiDigest = createHash("sha256")
  .update(createPublicKey(keys.publicKey).export({ type: "spki", format: "der" })).digest("hex");
const manifestSha256 = "a".repeat(64);
const eventSha256 = "b".repeat(64);

const policy: Day94GatewayTrustPolicy = {
  ...scope, trustRevision: "fixture-r1",
  expectedPeerId: "audit-gateway-01",
  pinnedPublicKeyPem: pem, pinnedSpkiSha256: spkiDigest,
  minimum: {
    snapshotId: "fixture-snapshot-95", revision: "r1",
    manifestSha256, checkpointSequence: 2, eventSha256
  }
};

function makePayload(
  req: Day94AuditGatewayRequest,
  sequence = 2,
  event = eventSha256
): Day94AuditGatewayPayload {
  return {
    domain: DAY94_AUDIT_GATEWAY_DOMAIN, ...scope,
    challengeHex: req.challengeHex,
    issuedAtEpochMs: now - 200,
    expiresAtEpochMs: now + 30_000,
    eventSha256: event,
    checkpoint: {
      domain: DAY93_AUDIT_ANCHOR_DOMAIN, ...scope,
      snapshotId: "fixture-snapshot-95", revision: "r1",
      manifestSha256, freezeVersion: sequence,
      state: sequence === 1 ? "frozen" : "invalidated",
      checkpointSequence: sequence,
      recordedAtEpochMs: now - 900,
      expiresAtEpochMs: now + 30_000
    }
  };
}

function signed(payload: Day94AuditGatewayPayload, wrong = false): Day94SignedGatewayReply {
  return {
    payload,
    signatureBase64: btoa(String.fromCharCode(...sign(null,
      encodeDay94GatewayPayload(payload),
      wrong ? wrongKeys.privateKey : keys.privateKey))),
    claimedAuthenticated: true,
    claimedPeerId: "audit-gateway-01"
  };
}


import { reviewDay95GatewayLifecycle, type Day95LifecyclePolicy, type Day95LifecycleInput } from
  "../runtime/recovery-writer-audit-gateway-key-lifecycle.js";
const active: Day95LifecyclePolicy = { ...policy, policyEpoch: 7, keyState: "active",
  notBeforeEpochMs: now - 1000, expiresAtEpochMs: now + 30_000, revokedSpkiSha256: [] };
const revoked: Day95LifecyclePolicy = { ...active, policyEpoch: 8, keyState: "revoked",
  revokedSpkiSha256: [active.pinnedSpkiSha256] };
const rotated: Day95LifecyclePolicy = { ...active, policyEpoch: 8, trustRevision: "fixture-r2",
  pinnedPublicKeyPem: wrongKeys.publicKey,
  pinnedSpkiSha256: createHash("sha256").update(createPublicKey(wrongKeys.publicKey)
    .export({ type: "spki", format: "der" })).digest("hex"),
  revokedSpkiSha256: [active.pinnedSpkiSha256] };
function input(first: Day95LifecyclePolicy, second = first, base = active,
  useNewKey = false): Day95LifecycleInput {
  let reads = 0;
  return { intent: "isolated_review", scope, baseline: base, clock: () => now,
    lifecycleReader: { async readPolicy() { return reads++ === 0 ? first : second; } },
    channel: {
      async inspectPeer() { return { peerId: "audit-gateway-01", transportAuthenticated: true }; },
      async fetchLatest(req) { return signed(makePayload(req), useNewKey); }
    }
  };
}
async function expect(reason: string, cfg: Day95LifecycleInput, verified?: boolean) {
  const result = await reviewDay95GatewayLifecycle(cfg);
  assert.equal(result.reason, reason);
  assert.equal(result.publishAuthorized, false);
  assert.equal(result.authenticatedExternalAnchorCount, 0);
  if (verified !== undefined) assert.equal(result.signatureVerified, verified);
}
await expect("fixture_lifecycle_consistent_authority_unproven", input(active), true);
await expect("policy_key_not_active", input(revoked, revoked, revoked), false);
await expect("policy_changed_during_review", input(active, revoked), true);
await expect("policy_epoch_rollback", input(active, active, revoked), false);
await expect("policy_same_epoch_conflict", input(active, { ...active, expiresAtEpochMs: now + 20_000 }), true);
await expect("policy_watermark_rollback", input({ ...rotated, minimum: { ...rotated.minimum, checkpointSequence: 1 } }), false);
await expect("policy_watermark_fork", input({ ...rotated, minimum: { ...rotated.minimum, eventSha256: "c".repeat(64) } }), false);
await expect("policy_watermark_advance_unverified", input({ ...rotated, minimum: { ...rotated.minimum, checkpointSequence: 3 } }), false);
await expect("gateway_signature_invalid", input(rotated), false);
await expect("fixture_lifecycle_consistent_authority_unproven", input(rotated, rotated, active, true), true);
await expect("policy_revocation_history_missing", input({ ...rotated, policyEpoch: 9, revokedSpkiSha256: [] }, rotated, rotated), false);
const mutable = { ...active, minimum: { ...active.minimum } };
const mutated = input(mutable);
const original = mutated.channel!;
const aliasRace = { ...mutated, channel: { ...original, async fetchLatest(req: Day94AuditGatewayRequest) {
  mutable.minimum.eventSha256 = "c".repeat(64);
  return original.fetchLatest(req);
} } };
await expect("policy_same_epoch_conflict", aliasRace, true);
let ticks = 0;
await expect("policy_key_outside_window", { ...input(active), clock: () => ticks++ ? now + 30_000 : now }, true);
await expect("policy_or_gateway_review_failed", { ...input(active), lifecycleReader: { async readPolicy() { throw Error("offline"); } } }, false);
await expect("production_release_not_authorized", { ...input(active), intent: "production_release" }, false);
console.log("Day 95 noon: lifecycle, revocation race, key rotation and watermark HOLD fixtures passed.");
