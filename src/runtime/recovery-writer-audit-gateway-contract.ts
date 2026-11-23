/**
 * Day 94 morning: signed external audit gateway *contract* (isolated lab).
 * An injected transport and supplied public-key pin do NOT independently prove
 * the gateway's authority, latest head, mTLS peer, or immutable external storage.
 * All outcomes are advisory HOLD; no production release path is implemented.
 */
import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";
import {
  DAY93_AUDIT_ANCHOR_DOMAIN,
  type Day93AuditAnchorCandidate
} from "./recovery-writer-inventory-audit-anchor.js";

export const DAY94_AUDIT_GATEWAY_DOMAIN =
  "agent-ai/recovery/external-audit-gateway/v1" as const;

export interface Day94AuditGatewayRequest extends Day91InventoryBinding {
  readonly domain: typeof DAY94_AUDIT_GATEWAY_DOMAIN;
  /** Locally generated, per-query, never supplied by a remote response. */
  readonly challengeHex: string;
  readonly requestedAtEpochMs: number;
}

export interface Day94AuditGatewayPayload extends Day91InventoryBinding {
  readonly domain: typeof DAY94_AUDIT_GATEWAY_DOMAIN;
  readonly challengeHex: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly checkpoint: Day93AuditAnchorCandidate;
  readonly eventSha256: string;
}

export interface Day94SignedGatewayReply {
  readonly payload: Day94AuditGatewayPayload;
  readonly signatureBase64: string;
  /** Untrusted extra claims in the response must never influence admission. */
  readonly claimedPeerId?: string;
  readonly claimedAuthenticated?: boolean;
}

export interface Day94AuditGatewayTransport {
  fetchLatest(request: Day94AuditGatewayRequest): Promise<Day94SignedGatewayReply | null>;
}

/** Canonical v1 signing bytes. Field order is explicit and versioned. */
export function encodeDay94GatewayPayload(payload: Day94AuditGatewayPayload): Uint8Array {
  const c = payload.checkpoint;
  const canonical = {
    domain: payload.domain,
    deploymentId: payload.deploymentId,
    releaseId: payload.releaseId,
    attemptId: payload.attemptId,
    challengeHex: payload.challengeHex,
    issuedAtEpochMs: payload.issuedAtEpochMs,
    expiresAtEpochMs: payload.expiresAtEpochMs,
    eventSha256: payload.eventSha256,
    checkpoint: {
      domain: c.domain,
      deploymentId: c.deploymentId,
      releaseId: c.releaseId,
      attemptId: c.attemptId,
      snapshotId: c.snapshotId,
      revision: c.revision,
      manifestSha256: c.manifestSha256,
      freezeVersion: c.freezeVersion,
      state: c.state,
      checkpointSequence: c.checkpointSequence,
      recordedAtEpochMs: c.recordedAtEpochMs,
      expiresAtEpochMs: c.expiresAtEpochMs
    }
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

export interface Day94GatewayReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: Day91InventoryBinding;
  readonly nowEpochMs: number;
  /** Injected in the lab. Production requires separately managed and pinned trust roots. */
  readonly pinnedPublicKeyPem: string | null;
  readonly transport: Day94AuditGatewayTransport | null;
}

export interface Day94GatewayReview {
  readonly action: "hold";
  readonly reason: string;
  readonly signatureVerifiedAgainstSuppliedPin: boolean;
  readonly authenticatedExternalAnchorCount: 0;
  readonly publishAuthorized: false;
}

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const HEX_NONCE = /^[a-f0-9]{64}$/;
const MAX_AGE = 60_000;

function validBinding(value: Day91InventoryBinding): boolean {
  return !!value && [value.deploymentId, value.releaseId, value.attemptId]
    .every(v => typeof v === "string" && ID.test(v));
}
function sameBinding(a: Day91InventoryBinding, b: Day91InventoryBinding): boolean {
  return a.deploymentId === b.deploymentId &&
    a.releaseId === b.releaseId && a.attemptId === b.attemptId;
}
function hold(reason: string, signatureVerifiedAgainstSuppliedPin = false): Day94GatewayReview {
  return {
    action: "hold",
    reason,
    signatureVerifiedAgainstSuppliedPin,
    authenticatedExternalAnchorCount: 0,
    publishAuthorized: false
  };
}

/**
 * The transport's metadata is NOT a credential. A valid lab signature only
 * verifies that the supplied fixture key signed the bytes, not that it is an
 * authorized external service or that this is its newest append-only head.
 */
export async function reviewDay94AuditGatewayCandidate(
  input: Day94GatewayReviewInput
): Promise<Day94GatewayReview> {
  if (!input || input.intent !== "isolated_review") {
    return hold("production_release_not_authorized");
  }
  if (!validBinding(input.scope) ||
      !Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    return hold("gateway_review_input_invalid");
  }
  if (!input.transport || typeof input.transport.fetchLatest !== "function") {
    return hold("gateway_transport_unavailable");
  }
  if (typeof input.pinnedPublicKeyPem !== "string" ||
      !input.pinnedPublicKeyPem.trim()) {
    return hold("gateway_public_key_pin_missing");
  }

  const request: Day94AuditGatewayRequest = {
    domain: DAY94_AUDIT_GATEWAY_DOMAIN,
    ...{
      deploymentId: input.scope.deploymentId,
      releaseId: input.scope.releaseId,
      attemptId: input.scope.attemptId
    },
    challengeHex: Array.from(randomBytes(32), b => b.toString(16).padStart(2, "0")).join(""),
    requestedAtEpochMs: input.nowEpochMs
  };
  let reply: Day94SignedGatewayReply | null;
  try {
    reply = await input.transport.fetchLatest(request);
  } catch {
    return hold("gateway_fetch_failed");
  }
  if (!reply) return hold("gateway_reply_missing");
  const payload = reply.payload;
  if (!payload || typeof payload !== "object" ||
      payload.domain !== DAY94_AUDIT_GATEWAY_DOMAIN) {
    return hold("gateway_domain_invalid");
  }
  if (!sameBinding(payload, request) ||
      !payload.checkpoint || !sameBinding(payload.checkpoint, request)) {
    return hold("gateway_attempt_binding_mismatch");
  }
  if (typeof payload.challengeHex !== "string" ||
      !HEX_NONCE.test(payload.challengeHex) ||
      payload.challengeHex !== request.challengeHex) {
    return hold("gateway_challenge_mismatch");
  }
  if (!Number.isSafeInteger(payload.issuedAtEpochMs) ||
      !Number.isSafeInteger(payload.expiresAtEpochMs) ||
      payload.issuedAtEpochMs > input.nowEpochMs + 30_000 ||
      payload.issuedAtEpochMs < input.nowEpochMs - MAX_AGE ||
      payload.expiresAtEpochMs <= input.nowEpochMs ||
      payload.expiresAtEpochMs <= payload.issuedAtEpochMs) {
    return hold("gateway_reply_stale_or_time_invalid");
  }
  const c = payload.checkpoint;
  if (c.domain !== DAY93_AUDIT_ANCHOR_DOMAIN ||
      !ID.test(c.snapshotId) || !ID.test(c.revision) ||
      !SHA.test(c.manifestSha256) || !SHA.test(payload.eventSha256) ||
      (c.state !== "frozen" && c.state !== "invalidated") ||
      !Number.isSafeInteger(c.freezeVersion) || c.freezeVersion < 1 ||
      !Number.isSafeInteger(c.checkpointSequence) ||
      c.checkpointSequence < c.freezeVersion ||
      !Number.isSafeInteger(c.recordedAtEpochMs) ||
      !Number.isSafeInteger(c.expiresAtEpochMs) ||
      c.recordedAtEpochMs > input.nowEpochMs ||
      c.recordedAtEpochMs < input.nowEpochMs - MAX_AGE ||
      c.expiresAtEpochMs <= input.nowEpochMs) {
    return hold("gateway_checkpoint_invalid_or_stale");
  }
  let validSignature = false;
  try {
    // Strict base64 guard prevents unexpected decoder normalization.
    const s = reply.signatureBase64;
    if (typeof s !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(s)) {
      return hold("gateway_signature_invalid");
    }
    const pin = createPublicKey(input.pinnedPublicKeyPem);
    if (pin.asymmetricKeyType !== "ed25519") {
      return hold("gateway_key_type_invalid");
    }
    validSignature = verify(
      null, encodeDay94GatewayPayload(payload), input.pinnedPublicKeyPem,
      Uint8Array.from(atob(s), char => char.charCodeAt(0))
    );
  } catch {
    return hold("gateway_signature_invalid");
  }
  if (!validSignature) return hold("gateway_signature_invalid");
  return hold("fixture_signature_verified_gateway_source_unproven", true);
}
