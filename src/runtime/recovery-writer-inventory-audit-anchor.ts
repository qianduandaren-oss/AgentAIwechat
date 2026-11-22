/**
 * Day 93 morning: read-only, ADVISORY comparison between the Day 92 SQLite
 * inventory freeze and a purportedly separate monotonic audit checkpoint.
 *
 * The injected reader is NOT authenticated. In particular, the caller may
 * control BOTH the SQLite file and the "external" anchor. This module never
 * issues production authorization. Real trust separation is a future task.
 */
import type { Day91InventoryBinding } from "./recovery-writer-cutover-inventory-adapter.js";
import type { WriterCutoverEvidenceScope } from "./recovery-writer-cutover-evidence-coverage.js";
import {
  SQLiteDay92InventoryFreezeStore
} from "./recovery-writer-inventory-freeze-store.js";

export const DAY93_AUDIT_ANCHOR_DOMAIN =
  "agent-ai/recovery/inventory-audit-anchor/v1" as const;

export type Day93FreezeState = "frozen" | "invalidated";

/** A *candidate* checkpoint. No field in this object proves authenticity. */
export interface Day93AuditAnchorCandidate extends Day91InventoryBinding {
  readonly domain: typeof DAY93_AUDIT_ANCHOR_DOMAIN;
  readonly snapshotId: string;
  readonly revision: string;
  readonly manifestSha256: string;
  readonly freezeVersion: number;
  readonly state: Day93FreezeState;
  /** Must never decrease for an authoritative append-only audit timeline. */
  readonly checkpointSequence: number;
  readonly recordedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

export interface Day93AuditAnchorReader {
  readAnchor(binding: Day91InventoryBinding): Promise<Day93AuditAnchorCandidate | null>;
}

export interface Day93AuditAnchorReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly store: SQLiteDay92InventoryFreezeStore;
  readonly reader: Day93AuditAnchorReader | null;
  readonly nowEpochMs: number;
}

export interface Day93AuditAnchorReview {
  readonly action: "hold";
  readonly reason: string;
  readonly localFreezeVersion: number | null;
  readonly candidateCheckpointSequence: number | null;
  readonly authenticatedExternalAnchorCount: 0;
  readonly publishAuthorized: false;
}

const ID = /^[A-Za-z0-9._:\/\[\]-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_AGE_MS = 5 * 60_000;

export async function reviewDay93AuditAnchorCandidate(
  input: Day93AuditAnchorReviewInput
): Promise<Day93AuditAnchorReview> {
  const hold = (
    reason: string,
    localFreezeVersion: number | null = null,
    candidateCheckpointSequence: number | null = null
  ): Day93AuditAnchorReview => ({
    action: "hold",
    reason,
    localFreezeVersion,
    candidateCheckpointSequence,
    authenticatedExternalAnchorCount: 0,
    publishAuthorized: false
  });

  if (!input || input.intent !== "isolated_review") {
    return hold("production_release_not_authorized");
  }
  const scope = input.scope;
  if (!scope || ![scope.deploymentId, scope.releaseId, scope.attemptId]
    .every(value => typeof value === "string" && ID.test(value)) ||
      !Number.isSafeInteger(input.nowEpochMs) || input.nowEpochMs < 0) {
    return hold("audit_anchor_review_input_invalid");
  }
  if (!input.reader || typeof input.reader.readAnchor !== "function") {
    return hold("audit_anchor_reader_unavailable");
  }

  let local: ReturnType<SQLiteDay92InventoryFreezeStore["load"]>;
  try {
    local = input.store.load(scope);
  } catch {
    return hold("local_freeze_unreadable_or_tampered");
  }
  if (!local) return hold("local_freeze_missing");

  let anchor: Day93AuditAnchorCandidate | null;
  try {
    anchor = await input.reader.readAnchor({
      deploymentId: scope.deploymentId,
      releaseId: scope.releaseId,
      attemptId: scope.attemptId
    });
  } catch {
    return hold("audit_anchor_read_failed", local.version);
  }
  if (!anchor) return hold("audit_anchor_missing", local.version);
  const version = local.version;
  const sequence = anchor.checkpointSequence;
  const reject = (reason: string): Day93AuditAnchorReview =>
    hold(reason, version, Number.isSafeInteger(sequence) ? sequence : null);

  if (anchor.domain !== DAY93_AUDIT_ANCHOR_DOMAIN ||
      !Number.isSafeInteger(anchor.freezeVersion) || anchor.freezeVersion < 1 ||
      !Number.isSafeInteger(sequence) || sequence < 1 ||
      sequence < anchor.freezeVersion ||
      !SHA256.test(anchor.manifestSha256) ||
      !["frozen", "invalidated"].includes(anchor.state) ||
      !ID.test(anchor.snapshotId) || !ID.test(anchor.revision)) {
    return reject("audit_anchor_format_invalid");
  }
  if (anchor.deploymentId !== scope.deploymentId ||
      anchor.releaseId !== scope.releaseId ||
      anchor.attemptId !== scope.attemptId) {
    return reject("audit_anchor_attempt_binding_mismatch");
  }
  if (!Number.isSafeInteger(anchor.recordedAtEpochMs) ||
      !Number.isSafeInteger(anchor.expiresAtEpochMs) ||
      anchor.recordedAtEpochMs > input.nowEpochMs ||
      anchor.expiresAtEpochMs <= anchor.recordedAtEpochMs) {
    return reject("audit_anchor_time_invalid");
  }
  if (anchor.expiresAtEpochMs <= input.nowEpochMs ||
      input.nowEpochMs - anchor.recordedAtEpochMs > MAX_AGE_MS) {
    return reject("audit_anchor_stale_or_expired");
  }
  if (anchor.snapshotId !== local.snapshotId ||
      anchor.revision !== local.revision) {
    return reject("audit_anchor_snapshot_binding_mismatch");
  }
  if (local.version < anchor.freezeVersion) {
    return reject("sqlite_rollback_suspected_anchor_ahead");
  }
  if (local.version > anchor.freezeVersion) {
    return reject("audit_anchor_lagging_or_split_brain");
  }
  if (local.manifestSha256 !== anchor.manifestSha256) {
    return reject("audit_anchor_manifest_digest_mismatch");
  }
  if (local.state !== anchor.state) {
    return reject("audit_anchor_state_conflict");
  }
  return reject(local.state === "invalidated"
    ? "attempt_invalidated_no_reuse"
    : "checkpoint_candidate_consistent_but_source_unverified");
}
