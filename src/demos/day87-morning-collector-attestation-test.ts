import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalWriterCollectorClaims, reviewSignedWriterCollectorArtifact,
  writerCollectorSigningBytes, type WriterCollectorClaims,
  type WriterCollectorAttestationInput, type SignedWriterCollectorArtifact
} from "../runtime/recovery-writer-collector-attestation.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const rogue = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const now = Date.UTC(2026, 10, 16, 0, 0, 0);
const rawArtifactBytes = new TextEncoder().encode("fixture:/proc/pid/fd=7 flags=O_RDWR inode=123");
const digest = createHash("sha256").update(rawArtifactBytes).digest("hex");
const claims: WriterCollectorClaims = {
  schemaVersion: 1, deploymentId: "staging:day87", releaseId: "release-87",
  observerId: "host-probe", hostId: "host-01", mountNamespaceId: "mnt:[4026531840]",
  challengeId: "nonce-0123456789abcdef", observedAtEpochMs: now - 1000,
  artifactSha256: digest
};
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
function signed(
  payloadBytes = canonicalWriterCollectorClaims(claims),
  key = privateKey,
  rawBytes = rawArtifactBytes
): SignedWriterCollectorArtifact {
  return {
    keyId: "pinned-host-key-1", payloadBytes,
    signatureHex: toHex(sign(null, writerCollectorSigningBytes(payloadBytes), key)),
    rawArtifactBytes: rawBytes
  };
}
const base: WriterCollectorAttestationInput = {
  intent: "isolated_review", deploymentId: claims.deploymentId,
  releaseId: claims.releaseId, expectedObserverId: claims.observerId,
  expectedHostId: claims.hostId,
  expectedMountNamespaceId: claims.mountNamespaceId,
  expectedChallengeId: claims.challengeId, nowEpochMs: now,
  pinnedKeyId: "pinned-host-key-1", pinnedEd25519PublicKeyPem: publicKey,
  artifact: signed()
};
assert.deepEqual(reviewSignedWriterCollectorArtifact(base), {
  action: "ready_for_isolated_attestation_binding_test",
  artifactSha256: digest, publishAuthorized: false
});
function reject(input: WriterCollectorAttestationInput, reason: string): void {
  assert.deepEqual(reviewSignedWriterCollectorArtifact(input), {
    action: "hold", reason, publishAuthorized: false
  });
}
reject({ ...base, intent: "production_release" }, "production_attestation_not_authorized");
reject({ ...base, artifact: null }, "artifact_missing");
reject({ ...base, artifact: { ...base.artifact!, keyId: "other" } }, "collector_key_mismatch");
reject({ ...base, artifact: { ...base.artifact!, signatureHex: "abc" } }, "signature_encoding_invalid");
reject({ ...base, artifact: { ...base.artifact!, rawArtifactBytes: new Uint8Array(0) } },
  "artifact_bytes_invalid");
reject({ ...base, artifact: signed(undefined, rogue.privateKey) }, "collector_signature_invalid");
reject({ ...base, artifact: {
  ...base.artifact!, payloadBytes: new TextEncoder().encode("tampered")
} }, "collector_signature_invalid");
reject({ ...base, expectedHostId: "host-other" }, "signed_target_mismatch");
reject({ ...base, releaseId: "release-other" }, "signed_target_mismatch");
reject({ ...base, expectedMountNamespaceId: "mnt:[99]" }, "signed_target_mismatch");
reject({ ...base, expectedChallengeId: "nonce-other-123456789" }, "challenge_mismatch");
reject({ ...base, nowEpochMs: now + 300_001 }, "signed_evidence_stale_or_clock_invalid");
reject({ ...base, artifact: signed(undefined, privateKey,
  new TextEncoder().encode("different inode")) }, "raw_artifact_digest_mismatch");
const formatted = new TextEncoder().encode(
  JSON.stringify(JSON.parse(new TextDecoder().decode(canonicalWriterCollectorClaims(claims))), null, 2)
);
reject({ ...base, artifact: signed(formatted) }, "signed_payload_not_canonical");
const wrongClaim = new TextEncoder().encode(JSON.stringify({
  ...claims, schemaVersion: 2
}));
reject({ ...base, artifact: signed(wrongClaim) }, "signed_claims_invalid");
reject({ ...base, artifact: signed(new TextEncoder().encode("{}")) }, "signed_claims_invalid");
assert.equal(reviewSignedWriterCollectorArtifact(base).publishAuthorized, false);
console.log("PASS Day 87 morning: Ed25519 signature, pin, raw bytes digest, host/ns/release/challenge/freshness binding.");
console.log("LIMIT: fixture key only; real collector, trusted key provisioning, nonce one-time consumption and OS proof not verified. Production NO_GO.");
