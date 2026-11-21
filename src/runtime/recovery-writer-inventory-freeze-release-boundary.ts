/**
 * Day 92 evening: compose a durable fixture freeze with the existing Day 91
 * three-source evidence review. Advisory HOLD-only code, never a GO gate.
 *
 * The expected digest/version are supplied by the isolated caller, NOT by an
 * authenticated external monotonic anchor. DB rollback + caller-pin rollback
 * can therefore defeat this review; production authorization is forbidden.
 */
import {
  reviewDay91EvidenceChain,
  type Day91ConsumerAckCandidate
} from "./recovery-writer-cutover-evidence-chain.js";
import type {
  Day91DeploymentInventoryAdapter,
  Day91InventoryAnchor
} from "./recovery-writer-cutover-inventory-adapter.js";
import type {
  WriterCutoverEvidenceReceipt,
  WriterCutoverEvidenceScope
} from "./recovery-writer-cutover-evidence-coverage.js";
import {
  SQLiteDay92InventoryFreezeStore
} from "./recovery-writer-inventory-freeze-store.js";

export interface Day92FrozenCutoverReviewInput {
  readonly intent: "isolated_review" | "production_release";
  readonly scope: WriterCutoverEvidenceScope;
  readonly expectedAnchor: Day91InventoryAnchor;
  readonly nowEpochMs: number;
  readonly store: SQLiteDay92InventoryFreezeStore;
  /** Fixture-only version/digest: never claim independent authority. */
  readonly expectedFreezeVersion: number;
  readonly expectedFreezeSha256: string;
  readonly inventoryAdapter: Day91DeploymentInventoryAdapter | null;
  readonly hostReceipts: ReadonlyArray<WriterCutoverEvidenceReceipt>;
  readonly consumerAck: Day91ConsumerAckCandidate | null;
}

export interface Day92FrozenCutoverReview {
  readonly action: "hold";
  readonly freezeReason: string;
  readonly evidenceChainReasons: ReadonlyArray<string>;
  readonly requiredHostCheckSlots: number;
  readonly requiredSourceTasks: number;
  readonly authenticatedEvidenceCount: 0;
  readonly publishAuthorized: false;
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Inspect a pinned, already-frozen record without granting release.
 * A caller-held pin only catches mutations if the attacker cannot alter the
 * pin too. This intentionally does not implement authoritative audit/GO.
 */
export async function reviewDay92FrozenCutoverBoundary(
  input: Day92FrozenCutoverReviewInput
): Promise<Day92FrozenCutoverReview> {
  let freezeReason = "freeze_not_reviewed";
  if (input.intent !== "isolated_review") {
    freezeReason = "production_release_not_authorized";
  } else if (!Number.isSafeInteger(input.expectedFreezeVersion) ||
      input.expectedFreezeVersion < 1 ||
      !SHA256.test(input.expectedFreezeSha256)) {
    freezeReason = "freeze_expected_pin_invalid";
  } else {
    try {
      const record = input.store.load(input.scope);
      if (!record) freezeReason = "freeze_missing";
      else if (record.state !== "frozen") freezeReason = "freeze_attempt_invalidated";
      else if (record.version !== input.expectedFreezeVersion) {
        freezeReason = "freeze_version_mismatch";
      } else if (record.manifestSha256 !== input.expectedFreezeSha256) {
        freezeReason = "freeze_digest_mismatch";
      } else if (record.snapshotId !== input.expectedAnchor.snapshotId ||
          record.revision !== input.expectedAnchor.revision) {
        freezeReason = "freeze_anchor_mismatch";
      } else if (!Number.isSafeInteger(input.nowEpochMs) ||
          input.nowEpochMs < record.capturedAtEpochMs ||
          input.nowEpochMs >= record.expiresAtEpochMs ||
          input.nowEpochMs - record.capturedAtEpochMs > 300_000) {
        freezeReason = "freeze_stale_or_clock_invalid";
      } else {
        freezeReason = "fixture_freeze_consistent_but_source_unverified";
      }
    } catch {
      freezeReason = "freeze_store_unavailable_or_tampered";
    }
  }
  const chain = await reviewDay91EvidenceChain({
    intent: input.intent,
    scope: input.scope,
    expectedAnchor: input.expectedAnchor,
    nowEpochMs: input.nowEpochMs,
    inventoryAdapter: input.inventoryAdapter,
    hostReceipts: input.hostReceipts,
    consumerAck: input.consumerAck
  });
  return {
    action: "hold",
    freezeReason,
    evidenceChainReasons: chain.reasons,
    requiredHostCheckSlots: chain.requiredHostCheckSlots,
    requiredSourceTasks: chain.requiredSourceTasks,
    authenticatedEvidenceCount: 0,
    publishAuthorized: false
  };
}
