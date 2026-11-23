import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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

const now = Date.UTC(2026, 10, 23, 4, 0);
const scope = {
  deploymentId: "staging:day94", releaseId: "release-94",
  attemptId: "attempt-94-01"
};
const keys = generateKeyPairSync("ed25519");
const wrongKeys = generateKeyPairSync("ed25519");
const pem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const spkiDigest = createHash("sha256")
  .update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const manifestSha256 = "a".repeat(64);
const eventSha256 = "b".repeat(64);

const policy: Day94GatewayTrustPolicy = {
  ...scope, trustRevision: "fixture-r1",
  expectedPeerId: "audit-gateway-01",
  pinnedPublicKeyPem: pem, pinnedSpkiSha256: spkiDigest,
  minimum: {
    snapshotId: "fixture-snapshot-94", revision: "r1",
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
      snapshotId: "fixture-snapshot-94", revision: "r1",
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
    signatureBase64: sign(null, encodeDay94GatewayPayload(payload),
      wrong ? wrongKeys.privateKey : keys.privateKey).toString("base64"),
    claimedAuthenticated: true,
    claimedPeerId: "audit-gateway-01"
  };
}

function config(overrides: {
  policy?: Day94GatewayTrustPolicy | null;
  observedPeerId?: string;
  peerAuthenticated?: boolean;
  provide?: (req: Day94AuditGatewayRequest) => Promise<Day94SignedGatewayReply | null>;
} = {}): Day94GatewayPinnedReviewInput {
  const channel: Day94GatewayPinnedChannel = {
    async inspectPeer() {
      return {
        peerId: overrides.observedPeerId ?? "audit-gateway-01",
        transportAuthenticated: overrides.peerAuthenticated ?? true
      };
    },
    async fetchLatest(req) {
      if (overrides.provide) return overrides.provide(req);
      return signed(makePayload(req));
    }
  };
  return {
    intent: "isolated_review", scope, nowEpochMs: now,
    policyReader: { async readPolicy() { return overrides.policy === undefined
      ? policy : overrides.policy; } },
    channel
  };
}

async function expectReason(
  expected: string,
  input: Day94GatewayPinnedReviewInput,
  expectedSignature = false
) {
  const review = await reviewDay94PinnedGatewayWatermark(input);
  assert.equal(review.reason, expected);
  assert.equal(review.action, "hold");
  assert.equal(review.publishAuthorized, false);
  assert.equal(review.authenticatedExternalAnchorCount, 0);
  assert.equal(review.signatureVerifiedAgainstConfiguredPin, expectedSignature);
  return review;
}

// A configured fixture peer + Ed25519 + pinned head still never becomes authority.
const baseline = await expectReason(
  "fixture_gateway_identity_and_head_match_but_authority_unproven",
  config(), true
);
assert.equal(baseline.peerMatchedInFixture, true);
assert.equal(baseline.pinnedMinimumSequence, 2);
assert.equal(baseline.observedSequence, 2);

// Re-signed old head passes the fresh challenge and signature: pin must reject.
const rollback = await expectReason(
  "gateway_checkpoint_below_pinned_high_watermark",
  config({ provide: async req => signed(makePayload(req, 1, "c".repeat(64))) }), true
);
assert.equal(rollback.observedSequence, 1);

// Same sequence, different event hash: possible fork/split brain.
await expectReason("gateway_checkpoint_same_sequence_event_conflict",
  config({ provide: async req => signed(makePayload(req, 2, "d".repeat(64))) }), true);
await expectReason("gateway_checkpoint_frozen_manifest_mismatch",
  config({ provide: async req => {
    const p = makePayload(req);
    return signed({ ...p, checkpoint: { ...p.checkpoint, manifestSha256: "e".repeat(64) } });
  } }), true);
await expectReason("gateway_checkpoint_above_pinned_minimum_unverified",
  config({ provide: async req => signed(makePayload(req, 3, "f".repeat(64))) }), true);

// Claimed peerId in signed response is NOT observed TLS peer identity.
await expectReason("gateway_peer_identity_mismatch",
  config({ observedPeerId: "untrusted-peer" }));
await expectReason("gateway_peer_unverified",
  config({ peerAuthenticated: false }));
await expectReason("gateway_peer_unverified", { ...config(), channel: {
  async inspectPeer() { return null; },
  async fetchLatest(req) { return signed(makePayload(req)); }
} });
const forgedClaim = await expectReason(
  "fixture_gateway_identity_and_head_match_but_authority_unproven",
  config({ provide: async req => ({
    ...signed(makePayload(req)), claimedPeerId: "evil", claimedAuthenticated: false
  }) }), true
);
assert.equal(forgedClaim.peerMatchedInFixture, true);

// Key pin must be independently provisioned: neither gateway claims nor
// supplied alternate keys can silently overwrite the configured fingerprint.
await expectReason("gateway_policy_key_fingerprint_mismatch",
  config({ policy: { ...policy, pinnedSpkiSha256: "0".repeat(64) } }));
await expectReason("gateway_policy_scope_mismatch",
  config({ policy: { ...policy, attemptId: "other" } }));
await expectReason("gateway_policy_missing", config({ policy: null }));
await expectReason("gateway_policy_reader_unavailable",
  { ...config(), policyReader: null });
await expectReason("gateway_policy_read_failed",
  { ...config(), policyReader: { async readPolicy() { throw Error("offline"); } } });
await expectReason("gateway_signature_invalid",
  config({ provide: async req => signed(makePayload(req), true) }));
await expectReason("gateway_channel_unavailable",
  { ...config(), channel: null });
await expectReason("production_release_not_authorized",
  { ...config(), intent: "production_release" });
console.log("Day 94 noon: peer identity, signature, rollback/fork and fail-closed HOLD fixtures passed.");
