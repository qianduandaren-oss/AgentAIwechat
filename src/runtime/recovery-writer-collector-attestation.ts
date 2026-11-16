/**
 * Day 87 morning: Ed25519 binds one collector artifact to a release/host/ns.
 * NOT a real collector, key authority, OS proof or production authorization.
 */
import { createHash, verify } from "node:crypto";

const DOMAIN = new TextEncoder().encode("AgentAIwechat:writer-release-attestation:v1\n");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const CHALLENGE = /^[A-Za-z0-9._:-]{16,128}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const MAX_PAYLOAD_BYTES = 8192;
const MAX_ARTIFACT_BYTES = 1024 * 1024;

export interface WriterCollectorClaims {
  readonly schemaVersion: 1;
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly observerId: string;
  readonly hostId: string;
  readonly mountNamespaceId: string;
  readonly challengeId: string;
  readonly observedAtEpochMs: number;
  readonly artifactSha256: string;
}

export interface SignedWriterCollectorArtifact {
  readonly keyId: string;
  readonly payloadBytes: Uint8Array;
  readonly signatureHex: string;
  readonly rawArtifactBytes: Uint8Array;
}

export interface WriterCollectorAttestationInput {
  readonly intent: "isolated_review" | "production_release";
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly expectedObserverId: string;
  readonly expectedHostId: string;
  readonly expectedMountNamespaceId: string;
  readonly expectedChallengeId: string;
  readonly nowEpochMs: number;
  /** Provisioned out-of-band; NEVER accept from worker JSON. */
  readonly pinnedKeyId: string;
  readonly pinnedEd25519PublicKeyPem: string;
  readonly artifact: SignedWriterCollectorArtifact | null;
}
export type WriterCollectorAttestationReview =
  | Readonly<{ action: "hold"; reason: string; publishAuthorized: false }>
  | Readonly<{ action: "ready_for_isolated_attestation_binding_test";
      artifactSha256: string; publishAuthorized: false }>;
const hold = (reason: string): WriterCollectorAttestationReview =>
  ({ action: "hold", reason, publishAuthorized: false });

export function canonicalWriterCollectorClaims(claims: WriterCollectorClaims): Uint8Array {
  return encoder.encode(JSON.stringify({
    schemaVersion: claims.schemaVersion,
    deploymentId: claims.deploymentId,
    releaseId: claims.releaseId,
    observerId: claims.observerId,
    hostId: claims.hostId,
    mountNamespaceId: claims.mountNamespaceId,
    challengeId: claims.challengeId,
    observedAtEpochMs: claims.observedAtEpochMs,
    artifactSha256: claims.artifactSha256
  }));
}
export function writerCollectorSigningBytes(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(DOMAIN.length + payload.length);
  bytes.set(DOMAIN);
  bytes.set(payload, DOMAIN.length);
  return bytes;
}
const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function reviewSignedWriterCollectorArtifact(
  input: WriterCollectorAttestationInput
): WriterCollectorAttestationReview {
  if (!input || (input.intent !== "isolated_review" &&
      input.intent !== "production_release")) return hold("intent_invalid");
  if (input.intent === "production_release") return hold("production_attestation_not_authorized");
  const identity = [input.deploymentId, input.releaseId, input.expectedObserverId,
    input.expectedHostId, input.expectedMountNamespaceId, input.pinnedKeyId];
  if (!identity.every(v => typeof v === "string" && ID.test(v)) ||
      typeof input.expectedChallengeId !== "string" ||
      !CHALLENGE.test(input.expectedChallengeId) ||
      typeof input.pinnedEd25519PublicKeyPem !== "string" ||
      !input.pinnedEd25519PublicKeyPem.trim()) return hold("trusted_context_invalid");
  const artifact = input.artifact;
  if (!artifact) return hold("artifact_missing");
  if (artifact.keyId !== input.pinnedKeyId) return hold("collector_key_mismatch");
  if (!(artifact.payloadBytes instanceof Uint8Array) ||
      artifact.payloadBytes.length === 0 ||
      artifact.payloadBytes.length > MAX_PAYLOAD_BYTES ||
      !(artifact.rawArtifactBytes instanceof Uint8Array) ||
      artifact.rawArtifactBytes.length === 0 ||
      artifact.rawArtifactBytes.length > MAX_ARTIFACT_BYTES) return hold("artifact_bytes_invalid");
  if (typeof artifact.signatureHex !== "string" ||
      !SIGNATURE.test(artifact.signatureHex)) return hold("signature_encoding_invalid");
  try {
    if (!verify(null, writerCollectorSigningBytes(artifact.payloadBytes),
      input.pinnedEd25519PublicKeyPem, hexToBytes(artifact.signatureHex))) {
      return hold("collector_signature_invalid");
    }
  } catch {
    return hold("collector_signature_invalid");
  }
  let parsed: Partial<WriterCollectorClaims> | null;
  try { parsed = JSON.parse(decoder.decode(artifact.payloadBytes)) as Partial<WriterCollectorClaims>; }
  catch { return hold("signed_payload_invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return hold("signed_payload_invalid");
  if (parsed.schemaVersion !== 1 ||
      ![parsed.deploymentId, parsed.releaseId, parsed.observerId,
        parsed.hostId, parsed.mountNamespaceId].every(v => typeof v === "string" && ID.test(v)) ||
      typeof parsed.challengeId !== "string" || !CHALLENGE.test(parsed.challengeId) ||
      typeof parsed.artifactSha256 !== "string" || !DIGEST.test(parsed.artifactSha256) ||
      !Number.isSafeInteger(parsed.observedAtEpochMs)) return hold("signed_claims_invalid");
  if (!equalBytes(artifact.payloadBytes, canonicalWriterCollectorClaims(
      parsed as WriterCollectorClaims))) return hold("signed_payload_not_canonical");
  if (parsed.deploymentId !== input.deploymentId ||
      parsed.releaseId !== input.releaseId ||
      parsed.observerId !== input.expectedObserverId ||
      parsed.hostId !== input.expectedHostId ||
      parsed.mountNamespaceId !== input.expectedMountNamespaceId) return hold("signed_target_mismatch");
  if (parsed.challengeId !== input.expectedChallengeId) return hold("challenge_mismatch");
  if (!Number.isSafeInteger(input.nowEpochMs) ||
      parsed.observedAtEpochMs! > input.nowEpochMs ||
      input.nowEpochMs - parsed.observedAtEpochMs! > 5 * 60_000) {
    return hold("signed_evidence_stale_or_clock_invalid");
  }
  const digest = createHash("sha256").update(artifact.rawArtifactBytes).digest("hex");
  if (digest !== parsed.artifactSha256) return hold("raw_artifact_digest_mismatch");
  return { action: "ready_for_isolated_attestation_binding_test",
    artifactSha256: digest, publishAuthorized: false };
}
