import { strict as assert } from "node:assert";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  DAY94_AUDIT_GATEWAY_DOMAIN,
  encodeDay94GatewayPayload,
  reviewDay94AuditGatewayCandidate,
  type Day94AuditGatewayRequest,
  type Day94AuditGatewayPayload,
  type Day94SignedGatewayReply
} from "../runtime/recovery-writer-audit-gateway-contract.js";
import { DAY93_AUDIT_ANCHOR_DOMAIN } from
  "../runtime/recovery-writer-inventory-audit-anchor.js";

const now = Date.UTC(2026, 10, 23, 0, 0, 0);
const scope = {
  deploymentId: "staging:day94",
  releaseId: "release-94",
  attemptId: "attempt-94-01"
};
const pair = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const alternate = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const pin = pair.publicKey;

function payloadFor(req: Day94AuditGatewayRequest): Day94AuditGatewayPayload {
  return {
    domain: DAY94_AUDIT_GATEWAY_DOMAIN,
    ...scope,
    challengeHex: req.challengeHex,
    issuedAtEpochMs: now - 500,
    expiresAtEpochMs: now + 30_000,
    eventSha256: "b".repeat(64),
    checkpoint: {
      domain: DAY93_AUDIT_ANCHOR_DOMAIN,
      ...scope,
      snapshotId: "fixture-94",
      revision: "r1",
      manifestSha256: "a".repeat(64),
      freezeVersion: 2,
      state: "invalidated",
      checkpointSequence: 2,
      recordedAtEpochMs: now - 1000,
      expiresAtEpochMs: now + 30_000
    }
  };
}
function signed(
  payload: Day94AuditGatewayPayload,
  key = pair.privateKey
): Day94SignedGatewayReply {
  return {
    payload,
    signatureBase64: btoa(String.fromCharCode(...sign(
      null, encodeDay94GatewayPayload(payload), key
    )))
  };
}
function review(
  provide: (request: Day94AuditGatewayRequest) => Promise<Day94SignedGatewayReply | null>,
  extra: Partial<Parameters<typeof reviewDay94AuditGatewayCandidate>[0]> = {}
) {
  return reviewDay94AuditGatewayCandidate({
    intent: "isolated_review",
    scope, nowEpochMs: now,
    pinnedPublicKeyPem: pin,
    transport: { fetchLatest: provide },
    ...extra
  });
}
async function expectReason(
  reason: string,
  provide: (request: Day94AuditGatewayRequest) => Promise<Day94SignedGatewayReply | null>,
  extra: Partial<Parameters<typeof reviewDay94AuditGatewayCandidate>[0]> = {}
) {
  const out = await review(provide, extra);
  assert.equal(out.reason, reason);
  assert.equal(out.action, "hold");
  assert.equal(out.authenticatedExternalAnchorCount, 0);
  assert.equal(out.publishAuthorized, false);
  return out;
}

const success = await expectReason(
  "fixture_signature_verified_gateway_source_unproven",
  async req => signed(payloadFor(req))
);
assert.equal(success.signatureVerifiedAgainstSuppliedPin, true);

await expectReason("gateway_transport_unavailable",
  async req => signed(payloadFor(req)), { transport: null });
await expectReason("gateway_public_key_pin_missing",
  async req => signed(payloadFor(req)), { pinnedPublicKeyPem: null });
await expectReason("gateway_reply_missing", async () => null);
await expectReason("gateway_fetch_failed", async () => { throw Error("offline"); });
await expectReason("gateway_domain_invalid",
  async req => signed({ ...payloadFor(req), domain: "wrong" as typeof DAY94_AUDIT_GATEWAY_DOMAIN }));
await expectReason("gateway_attempt_binding_mismatch",
  async req => signed({ ...payloadFor(req), attemptId: "other" }));
await expectReason("gateway_attempt_binding_mismatch",
  async req => signed({ ...payloadFor(req),
    checkpoint: { ...payloadFor(req).checkpoint, attemptId: "other" } }));
await expectReason("gateway_challenge_mismatch",
  async req => signed({ ...payloadFor(req), challengeHex: "c".repeat(64) }));
await expectReason("gateway_reply_stale_or_time_invalid",
  async req => signed({ ...payloadFor(req), issuedAtEpochMs: now - 120_000 }));
await expectReason("gateway_reply_stale_or_time_invalid",
  async req => signed({ ...payloadFor(req), expiresAtEpochMs: now - 1 }));
await expectReason("gateway_checkpoint_invalid_or_stale",
  async req => signed({ ...payloadFor(req),
    checkpoint: { ...payloadFor(req).checkpoint, checkpointSequence: 0 } }));
await expectReason("gateway_signature_invalid",
  async req => signed(payloadFor(req), alternate.privateKey));
await expectReason("gateway_signature_invalid",
  async req => ({ ...signed(payloadFor(req)), signatureBase64: "not-base64" }));

// Metadata claiming peer authentication is deliberately ignored.
const forged = await expectReason("fixture_signature_verified_gateway_source_unproven",
  async req => ({
    ...signed(payloadFor(req)),
    claimedPeerId: "production-control-plane",
    claimedAuthenticated: true
  }));
assert.equal(forged.signatureVerifiedAgainstSuppliedPin, true);

// A completed response cannot be replayed into a new random challenge.
let replay: Day94SignedGatewayReply | null = null;
await review(async req => { replay = signed(payloadFor(req)); return replay; });
await expectReason("gateway_challenge_mismatch", async () => replay);

// There must be no transport access and no GO for production intent.
let transportUsed = false;
await expectReason("production_release_not_authorized",
  async req => { transportUsed = true; return signed(payloadFor(req)); },
  { intent: "production_release" });
assert.equal(transportUsed, false);

console.log("PASS Day 94 morning: nonce, binding, freshness and Ed25519 lab pin checks.");
console.log("LIMIT: injected pin/transport not externally trusted; no authoritative high-water head.");
console.log("LIMIT: no authenticated mTLS/IAM gateway or production approval. NO_GO.");
