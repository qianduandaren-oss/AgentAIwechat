/**
 * Day 94 noon: read-only gateway identity + pinned high-water review (lab).
 *
 * This module composes the Day 94 morning Ed25519/challenge verifier, but
 * its injected policy provider and peer observation are TEST DOUBLES.
 * No trusted PKI/IAM, rollback-resistant authority, or release permission.
 */
import { createHash, createPublicKey } from "node:crypto";
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";
import {
  reviewDay94AuditGatewayCandidate,
  type Day94AuditGatewayTransport,
  type Day94SignedGatewayReply
} from "./recovery-writer-audit-gateway-contract.js";

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;

export interface Day94PinnedWatermark {
  readonly snapshotId: string;
  readonly revision: string;
  readonly manifestSha256: string;
  readonly checkpointSequence: number;
  readonly eventSha256: string;
}

/** Provisioned independently of the gateway reply; still just a lab fixture here. */
export interface Day94GatewayTrustPolicy extends Day91InventoryBinding {
  readonly trustRevision: string;
  readonly expectedPeerId: string;
  readonly pinnedPublicKeyPem: string;
  readonly pinnedSpkiSha256: string;
  readonly minimum: Day94PinnedWatermark;
}

export interface Day94GatewayTrustPolicyReader {
  readPolicy(binding: Day91InventoryBinding): Promise<Day94GatewayTrustPolicy | null>;
}

/**
 * Peer identity must come from the verified TLS/IAM channel, NOT the JSON reply.
 * The current injected adapter cannot establish that guarantee by itself.
 */
export interface Day94GatewayPeerObservation {
  readonly peerId: string;
  readonly transportAuthenticated: boolean;
}

export interface Day94GatewayPinnedChannel extends Day94AuditGatewayTransport {
  inspectPeer(): Promise<Day94GatewayPeerObservation | null>;
}

export interface Day94GatewayPinnedReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: Day91InventoryBinding;
  readonly nowEpochMs: number;
  readonly policyReader: Day94GatewayTrustPolicyReader | null;
  readonly channel: Day94GatewayPinnedChannel | null;
}

export interface Day94GatewayPinnedReview {
  readonly action: "hold";
  readonly reason: string;
  readonly peerMatchedInFixture: boolean;
  readonly signatureVerifiedAgainstConfiguredPin: boolean;
  readonly pinnedMinimumSequence: number | null;
  readonly observedSequence: number | null;
  readonly authenticatedExternalAnchorCount: 0;
  readonly publishAuthorized: false;
}

function sameBinding(a: Day91InventoryBinding, b: Day91InventoryBinding): boolean {
  return a.deploymentId === b.deploymentId &&
    a.releaseId === b.releaseId && a.attemptId === b.attemptId;
}

function validBinding(b: Day91InventoryBinding): boolean {
  return !!b && [b.deploymentId, b.releaseId, b.attemptId]
    .every(s => typeof s === "string" && ID.test(s));
}

function fingerprint(pem: string): string {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw Error("not_ed25519");
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function hold(
  reason: string,
  peerMatchedInFixture = false,
  signatureVerifiedAgainstConfiguredPin = false,
  pinnedMinimumSequence: number | null = null,
  observedSequence: number | null = null
): Day94GatewayPinnedReview {
  return {
    action: "hold", reason, peerMatchedInFixture,
    signatureVerifiedAgainstConfiguredPin, pinnedMinimumSequence, observedSequence,
    authenticatedExternalAnchorCount: 0, publishAuthorized: false
  };
}

/**
 * No grant/GO branch exists. A consistent signed candidate only establishes
 * that fixture-level signature/binding checks passed, not that a truly
 * independent service exposed its latest unrollbackable checkpoint.
 */
export async function reviewDay94PinnedGatewayWatermark(
  input: Day94GatewayPinnedReviewInput
): Promise<Day94GatewayPinnedReview> {
  if (!input || input.intent !== "isolated_review") {
    return hold("production_release_not_authorized");
  }
  if (!validBinding(input.scope) ||
      !Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    return hold("gateway_pinned_review_input_invalid");
  }
  if (!input.policyReader || typeof input.policyReader.readPolicy !== "function") {
    return hold("gateway_policy_reader_unavailable");
  }

  let policy: Day94GatewayTrustPolicy | null;
  try {
    policy = await input.policyReader.readPolicy(input.scope);
  } catch {
    return hold("gateway_policy_read_failed");
  }
  if (!policy) return hold("gateway_policy_missing");
  if (!sameBinding(input.scope, policy)) return hold("gateway_policy_scope_mismatch");

  const min = policy.minimum;
  if (!ID.test(policy.trustRevision) ||
      !ID.test(policy.expectedPeerId) ||
      !min || !ID.test(min.snapshotId) || !ID.test(min.revision) ||
      !SHA.test(min.manifestSha256) || !SHA.test(min.eventSha256) ||
      !Number.isSafeInteger(min.checkpointSequence) || min.checkpointSequence < 1 ||
      !SHA.test(policy.pinnedSpkiSha256) ||
      typeof policy.pinnedPublicKeyPem !== "string" ||
      !policy.pinnedPublicKeyPem.trim()) {
    return hold("gateway_policy_invalid");
  }
  try {
    if (fingerprint(policy.pinnedPublicKeyPem) !== policy.pinnedSpkiSha256) {
      return hold("gateway_policy_key_fingerprint_mismatch");
    }
  } catch {
    return hold("gateway_policy_key_invalid");
  }

  const seq = min.checkpointSequence;
  const channel = input.channel;
  if (!channel || typeof channel.inspectPeer !== "function" ||
      typeof channel.fetchLatest !== "function") {
    return hold("gateway_channel_unavailable", false, false, seq);
  }

  let peer: Day94GatewayPeerObservation | null;
  try {
    peer = await channel.inspectPeer();
  } catch {
    return hold("gateway_peer_observation_failed", false, false, seq);
  }
  if (!peer || peer.transportAuthenticated !== true ||
      !ID.test(peer.peerId)) {
    return hold("gateway_peer_unverified", false, false, seq);
  }
  if (peer.peerId !== policy.expectedPeerId) {
    return hold("gateway_peer_identity_mismatch", false, false, seq);
  }

  let captured: Day94SignedGatewayReply | null = null;
  const wrappedTransport: Day94AuditGatewayTransport = {
    async fetchLatest(req) {
      const response = await channel.fetchLatest(req);
      captured = response;
      return response;
    }
  };
  const check = await reviewDay94AuditGatewayCandidate({
    intent: "isolated_review",
    scope: input.scope,
    nowEpochMs: input.nowEpochMs,
    pinnedPublicKeyPem: policy.pinnedPublicKeyPem,
    transport: wrappedTransport
  });
  if (!check.signatureVerifiedAgainstSuppliedPin) {
    return hold(check.reason, true, false, seq);
  }

  // The signature verifier checked these values before we inspect them.
  const verified = captured as Day94SignedGatewayReply | null;
  if (!verified) return hold("gateway_verified_reply_missing", true, false, seq);
  const c = verified.payload.checkpoint;
  const observed = c.checkpointSequence;
  if (c.snapshotId !== min.snapshotId || c.revision !== min.revision ||
      c.manifestSha256 !== min.manifestSha256) {
    return hold("gateway_checkpoint_frozen_manifest_mismatch", true, true, seq, observed);
  }
  if (observed < seq) {
    return hold("gateway_checkpoint_below_pinned_high_watermark", true, true, seq, observed);
  }
  if (observed === seq && verified.payload.eventSha256 !== min.eventSha256) {
    return hold("gateway_checkpoint_same_sequence_event_conflict", true, true, seq, observed);
  }
  if (observed > seq) {
    return hold("gateway_checkpoint_above_pinned_minimum_unverified", true, true, seq, observed);
  }
  return hold("fixture_gateway_identity_and_head_match_but_authority_unproven",
    true, true, seq, observed);
}
