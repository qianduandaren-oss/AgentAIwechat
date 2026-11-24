/** Day 95 noon: read-only lifecycle policy fence, isolated fixtures only. */
import {
  reviewDay94PinnedGatewayWatermark,
  type Day94GatewayPinnedReviewInput,
  type Day94GatewayTrustPolicy
} from "./recovery-writer-audit-gateway-pinned-watermark.js";
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";

export interface Day95LifecyclePolicy extends Day94GatewayTrustPolicy {
  readonly policyEpoch: number;
  readonly keyState: "active" | "retired" | "revoked";
  readonly notBeforeEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly revokedSpkiSha256: readonly string[];
}
export interface Day95LifecycleInput extends Omit<Day94GatewayPinnedReviewInput, "policyReader" | "nowEpochMs"> {
  readonly baseline: Day95LifecyclePolicy;
  readonly lifecycleReader: { readPolicy(scope: Day91InventoryBinding): Promise<Day95LifecyclePolicy | null> };
  readonly clock: () => number;
}
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const match = "fixture_gateway_identity_and_head_match_but_authority_unproven";
function hold(reason: string, signatureVerified = false, policyEpoch: number | null = null) {
  return { action: "hold" as const, reason, signatureVerified, policyEpoch,
    authenticatedExternalAnchorCount: 0 as const, publishAuthorized: false as const };
}
function sameScope(a: Day91InventoryBinding, b: Day91InventoryBinding) {
  return a.deploymentId === b.deploymentId && a.releaseId === b.releaseId && a.attemptId === b.attemptId;
}
function valid(p: Day95LifecyclePolicy, scope: Day91InventoryBinding): boolean {
  return !!p && sameScope(p, scope) && Number.isSafeInteger(p.policyEpoch) && p.policyEpoch > 0 &&
    ["active", "retired", "revoked"].includes(p.keyState) &&
    [p.notBeforeEpochMs, p.expiresAtEpochMs].every(t => Number.isSafeInteger(t) && t >= 0) &&
    p.expiresAtEpochMs > p.notBeforeEpochMs &&
    [p.trustRevision, p.expectedPeerId, p.minimum?.snapshotId, p.minimum?.revision]
      .every(s => typeof s === "string" && ID.test(s)) &&
    typeof p.pinnedPublicKeyPem === "string" && p.pinnedPublicKeyPem.length > 0 &&
    [p.pinnedSpkiSha256, p.minimum?.manifestSha256, p.minimum?.eventSha256]
      .every(s => typeof s === "string" && SHA.test(s)) &&
    Number.isSafeInteger(p.minimum?.checkpointSequence) && p.minimum.checkpointSequence > 0 &&
    Array.isArray(p.revokedSpkiSha256) &&
    p.revokedSpkiSha256.every(s => typeof s === "string" && SHA.test(s)) &&
    new Set(p.revokedSpkiSha256).size === p.revokedSpkiSha256.length &&
    (p.keyState !== "revoked" || p.revokedSpkiSha256.includes(p.pinnedSpkiSha256));
}
function snapshot(p: Day95LifecyclePolicy): Day95LifecyclePolicy {
  return { ...p, minimum: { ...p.minimum }, revokedSpkiSha256: [...p.revokedSpkiSha256].sort() };
}
function identity(p: Day95LifecyclePolicy): string {
  const m = p.minimum;
  return JSON.stringify([p.deploymentId,p.releaseId,p.attemptId,p.policyEpoch,p.trustRevision,
    p.expectedPeerId,p.pinnedPublicKeyPem,p.pinnedSpkiSha256,p.keyState,p.notBeforeEpochMs,p.expiresAtEpochMs,
    p.revokedSpkiSha256,m.snapshotId,m.revision,m.manifestSha256,m.checkpointSequence,m.eventSha256]);
}
function compare(p: Day95LifecyclePolicy, base: Day95LifecyclePolicy): string | null {
  if (p.policyEpoch < base.policyEpoch) return "policy_epoch_rollback";
  if (p.policyEpoch === base.policyEpoch && identity(p) !== identity(base)) return "policy_same_epoch_conflict";
  if (base.revokedSpkiSha256.some(k => !p.revokedSpkiSha256.includes(k))) return "policy_revocation_history_missing";
  if (base.pinnedSpkiSha256 === p.pinnedSpkiSha256 && base.keyState !== "active" && p.keyState === "active")
    return "policy_key_reactivation_rejected";
  const a = p.minimum, b = base.minimum;
  if (a.snapshotId !== b.snapshotId || a.revision !== b.revision || a.manifestSha256 !== b.manifestSha256)
    return "policy_manifest_changed";
  if (a.checkpointSequence < b.checkpointSequence) return "policy_watermark_rollback";
  if (a.checkpointSequence === b.checkpointSequence && a.eventSha256 !== b.eventSha256)
    return "policy_watermark_fork";
  if (a.checkpointSequence > b.checkpointSequence) return "policy_watermark_advance_unverified";
  return null;
}
function eligible(p: Day95LifecyclePolicy, now: number): string | null {
  if (!Number.isSafeInteger(now) || now < 0) return "policy_clock_invalid";
  if (p.keyState !== "active" || p.revokedSpkiSha256.includes(p.pinnedSpkiSha256)) return "policy_key_not_active";
  if (now < p.notBeforeEpochMs || now >= p.expiresAtEpochMs) return "policy_key_outside_window";
  return null;
}
/** Baseline and reader are injected lab values, not authenticated control-plane state. */
export async function reviewDay95GatewayLifecycle(input: Day95LifecycleInput) {
  if (!input || input.intent !== "isolated_review") return hold("production_release_not_authorized");
  try {
    const scope = { ...input.scope };
    if (!valid(input.baseline, scope)) return hold("policy_baseline_invalid");
    const base = snapshot(input.baseline);
    const first = await input.lifecycleReader.readPolicy(scope);
    if (!first || !valid(first, scope)) return hold("policy_missing_or_invalid");
    const before = snapshot(first);
    const start = input.clock();
    const reason = compare(before, base) ?? eligible(before, start);
    if (reason) return hold(reason, false, before.policyEpoch);

    // Capture a detached response so end-of-review expiry can be checked.
    const channel = input.channel;
    if (!channel) return hold("gateway_channel_unavailable");
    let deadline = Number.MAX_SAFE_INTEGER;
    const check = await reviewDay94PinnedGatewayWatermark({
      intent: "isolated_review", scope, nowEpochMs: start,
      policyReader: { async readPolicy() { return before; } },
      channel: {
        async inspectPeer() { return channel.inspectPeer(); },
        async fetchLatest(req) {
          const reply = await channel.fetchLatest(req);
          if (!reply) return null;
          const copy = JSON.parse(JSON.stringify(reply)) as typeof reply;
          deadline = Math.min(copy.payload?.expiresAtEpochMs, copy.payload?.checkpoint?.expiresAtEpochMs);
          return copy;
        }
      }
    });
    const next = await input.lifecycleReader.readPolicy(scope);
    if (!next || !valid(next, scope)) return hold("policy_second_read_invalid", check.signatureVerifiedAgainstConfiguredPin);
    const after = snapshot(next);
    const end = input.clock();
    const changed = compare(after, before);
    if (changed) return hold(changed, check.signatureVerifiedAgainstConfiguredPin, after.policyEpoch);
    if (identity(before) !== identity(after))
      return hold("policy_changed_during_review", check.signatureVerifiedAgainstConfiguredPin, after.policyEpoch);
    const endReason = eligible(after, end);
    if (endReason) return hold(endReason, check.signatureVerifiedAgainstConfiguredPin, after.policyEpoch);
    if (end < start) return hold("policy_clock_rollback", check.signatureVerifiedAgainstConfiguredPin, after.policyEpoch);
    if (check.reason !== match) return hold(check.reason, check.signatureVerifiedAgainstConfiguredPin, after.policyEpoch);
    if (!Number.isSafeInteger(deadline) || end >= deadline || end - start > 60_000)
      return hold("gateway_reply_expired_during_review", true, after.policyEpoch);
    return hold("fixture_lifecycle_consistent_authority_unproven", true, after.policyEpoch);
  } catch {
    return hold("policy_or_gateway_review_failed");
  }
}
