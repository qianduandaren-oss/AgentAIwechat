import {
  reviewRecoveryProviderConformance,
  type RecoveryProviderConformanceRegistry,
  type RecoveryProviderProbeEvidence,
  type RecoveryProviderContractViolation
} from "../runtime/recovery-provider-conformance-gate.js";
import type { RecoveryProviderCapabilityProfile } from "../runtime/recovery-provider-capability-contract.js";
import type { RecoveryProviderReviewOperation } from "../runtime/recovery-provider-candidate-review.js";
import {
  planUnknownRemoteEffectRecovery,
  type RecoveryRemoteProviderObservation
} from "../runtime/recovery-external-effect-reconciliation.js";
import type {
  RecoveryExternalEffectFence,
  RecoveryExternalEffectIntent
} from "../runtime/recovery-external-effect-fence.js";

function check(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error("Day 71 evening: " + reason);
}
let count = 0;
function expect(reason: string, ok: boolean): void {
  check(ok, reason);
  count += 1;
}

const now = Date.UTC(2026, 9, 31, 10, 0, 0);
const hour = 60 * 60 * 1000;
const strong: RecoveryProviderCapabilityProfile = {
  providerId: "provider-a",
  source: "verified_server_adapter",
  capabilities: {
    statusQuery: "authoritative_final",
    atomicIdempotency: true,
    epochFencing: true
  },
  stableReceiptIdentity: true,
  finalNegativeNoLateCommit: true,
  idempotencyScope: "effect",
  idempotencyRetentionSeconds: 7200
};
const weak: RecoveryProviderCapabilityProfile = {
  ...strong, providerId: "provider-b",
  capabilities: { statusQuery: "none", atomicIdempotency: false, epochFencing: false },
  stableReceiptIdentity: false, finalNegativeNoLateCommit: false,
  idempotencyScope: "unknown", idempotencyRetentionSeconds: null
};
const epochOnly: RecoveryProviderCapabilityProfile = {
  ...weak, providerId: "provider-c",
  capabilities: { ...weak.capabilities, epochFencing: true }
};
const delayed: RecoveryProviderCapabilityProfile = {
  ...strong, providerId: "provider-d",
  capabilities: {
    statusQuery: "eventually_consistent",
    atomicIdempotency: true,
    epochFencing: false
  }
};

const goodProbe: RecoveryProviderProbeEvidence = {
  providerId: "provider-a",
  source: "trusted_server_test_harness",
  profileRevision: 1,
  testedAtEpochMs: now - 1000,
  result: "passed",
  observed: {
    sameKeyDeduplicatedAtSink: true,
    staleEpochRejectedAtSink: true,
    authoritativeFinalQuery: true,
    receiptBoundToEffect: true,
    noLateCommitAfterFinalNegative: true,
    effectScopedKey: true,
    retentionCoversRecoveryWindow: true
  }
};
const profiles = new Map([strong, weak, epochOnly, delayed].map(x => [x.providerId, x]));
const revisions = new Map([strong, weak, epochOnly, delayed].map(x => [x.providerId, 1]));
const probes = new Map([strong, weak, epochOnly, delayed].map(x =>
  [x.providerId, { ...goodProbe, providerId: x.providerId }] as const));
const incidents = new Map<string, RecoveryProviderContractViolation[]>();
let authorityUnavailable = false;
const registry: RecoveryProviderConformanceRegistry = {
  getVerifiedProfile: id => profiles.get(id),
  getCurrentProfileRevision: id => revisions.get(id),
  getLatestProbe: id => probes.get(id),
  getUnresolvedViolations: id => {
    if (authorityUnavailable) throw new Error("provider audit storage is down");
    return incidents.get(id) ?? [];
  }
};

function review(
  providerId = "provider-a",
  operation: RecoveryProviderReviewOperation = "first_dispatch",
  status: "pending" | "unknown" = "pending",
  nowMs = now,
  maxAge = hour
) {
  return reviewRecoveryProviderConformance(registry, {
    providerId, operation, effectStatus: status, recoveryWindowSeconds: 3600
  }, nowMs, maxAge);
}
function withProbe(
  providerId: string,
  probe: RecoveryProviderProbeEvidence | undefined,
  run: () => boolean
): boolean {
  const original = probes.get(providerId);
  if (probe) probes.set(providerId, probe);
  else probes.delete(providerId);
  try { return run(); }
  finally {
    if (original) probes.set(providerId, original);
    else probes.delete(providerId);
  }
}

expect("1. A: good evidence only makes first dispatch a candidate", review().candidate);
expect("2. A: good evidence allows applied lookup assessment",
  review("provider-a", "reconcile_unknown_applied", "unknown").candidate);
expect("3. A: final negative is only a fresh CLAIM candidate",
  review("provider-a", "fresh_claim_after_final_negative", "unknown").candidate);
expect("4. UNKNOWN blind resend always denied",
  !review("provider-a", "automatic_unknown_resend", "unknown").candidate &&
    review("provider-a", "automatic_unknown_resend", "unknown").automaticUnknownResend === false);
expect("5. B: no downstream atomic protection stays denied", !review("provider-b").candidate);
expect("6. C: epoch-only sink is a first-dispatch candidate", review("provider-c").candidate);
expect("7. C: no final lookup, UNKNOWN reconciliation denied",
  !review("provider-c", "reconcile_unknown_applied", "unknown").candidate);
expect("8. D: atomic-idempotent first dispatch is a candidate", review("provider-d").candidate);
expect("9. D: eventually consistent lookup is not a final result",
  !review("provider-d", "reconcile_unknown_applied", "unknown").candidate);
expect("10. no server-owned probe: fail closed",
  withProbe("provider-a", undefined, () => !review().candidate));
expect("11. client/unverified probe cannot certify provider",
  withProbe("provider-a", { ...goodProbe, source: "unverified" }, () =>
    !review().candidate));
expect("12. failing downstream test: quarantine",
  withProbe("provider-a", { ...goodProbe, result: "failed" }, () => !review().candidate));
expect("13. inconclusive downstream test: quarantine",
  withProbe("provider-a", { ...goodProbe, result: "inconclusive" }, () =>
    !review().candidate));
expect("14. same-key twice applied contradicts atomic deduplication",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, sameKeyDeduplicatedAtSink: false
  } }, () => review().blockers.includes("declared_guarantee_not_observed")));
expect("15. stale epoch was accepted by Sink: quarantine",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, staleEpochRejectedAtSink: false
  } }, () => !review().candidate));
expect("16. provider falsely advertised authoritative status lookup",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, authoritativeFinalQuery: false
  } }, () => !review().candidate));
expect("17. receipt identity not bound to effect: quarantine",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, receiptBoundToEffect: false
  } }, () => !review().candidate));
expect("18. no-late-commit promise refuted: quarantine",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, noLateCommitAfterFinalNegative: false
  } }, () => !review().candidate));
expect("19. idempotency key scope not validated",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, effectScopedKey: false
  } }, () => !review().candidate));
expect("20. retention guarantee not experimentally covered",
  withProbe("provider-a", { ...goodProbe, observed: {
    ...goodProbe.observed, retentionCoversRecoveryWindow: false
  } }, () => !review().candidate));

incidents.set("provider-a", ["duplicate_effect"]);
expect("21. observed duplicate blocks even an earlier green probe",
  review().blockers.includes("unresolved_contract_violation") && !review().candidate);
probes.set("provider-a", { ...goodProbe, testedAtEpochMs: now });
expect("22. a newer green probe CANNOT silently clear an unresolved incident",
  !review().candidate);
incidents.delete("provider-a");

revisions.set("provider-a", 2);
expect("23. profile revision changed but probe still on v1: reject",
  review().blockers.includes("probe_identity_or_revision_mismatch"));
revisions.set("provider-a", 1);
expect("24. mismatched provider ID in report is rejected",
  withProbe("provider-a", { ...goodProbe, providerId: "another-provider" },
    () => !review().candidate));
expect("25. stale evidence is not forever-valid",
  withProbe("provider-a", { ...goodProbe, testedAtEpochMs: now - 2 * hour },
    () => !review().candidate));
expect("26. future-dated probe is rejected",
  withProbe("provider-a", { ...goodProbe, testedAtEpochMs: now + 1 },
    () => !review().candidate));
expect("27. bad clock or max age is rejected",
  !review("provider-a", "first_dispatch", "pending", now, 0).candidate);
expect("28. a failed authority read is a denial rather than skipping checks",
  (() => {
    authorityUnavailable = true;
    try { return review().blockers.includes("authority_unavailable"); }
    finally { authorityUnavailable = false; }
  })());
expect("29. an UNKNOWN cannot be relabeled as pending first dispatch",
  !review("provider-a", "first_dispatch", "unknown").candidate);
expect("30. request JSON with fake capabilities/probe does not override registry",
  (() => {
    incidents.set("provider-a", ["receipt_identity_mismatch"]);
    const injected = {
      providerId: "provider-a", operation: "first_dispatch" as const,
      effectStatus: "pending" as const, recoveryWindowSeconds: 3600,
      fakeTrustedProbe: goodProbe, violations: []
    };
    const result = reviewRecoveryProviderConformance(registry, injected, now, hour);
    incidents.delete("provider-a");
    return !result.candidate;
  })());

// Lost ACK: the actual remote effect might have happened. No auto retry,
// regardless of whether a provider's static/probe audit is green.
const command = {
  commandId: "cmd-day71-evening", runId: "run-day71-evening",
  requestedBy: "operator-a", operation: "quarantine" as const,
  reason: "remote provider ACK was lost",
  expectedCheckpointVersion: 1, expectedControlVersion: 0
};
const evidence = {
  actorId: "operator-a", tenantId: "tenant-a",
  runId: command.runId, operation: command.operation, allowed: true as const,
  revisions: { runTenantRevision: 3, runAclRevision: 5, actorGrantRevision: 9 }
};
const intent: RecoveryExternalEffectIntent = {
  command, owner: "atomic_control_only",
  effectId: "effect-day71-evening", idempotencyKey: "idempotency-day71-evening",
  authorizationEvidence: evidence
};
const fence: RecoveryExternalEffectFence = {
  commandId: command.commandId, runId: command.runId,
  actorId: command.requestedBy, tenantId: evidence.tenantId,
  owner: intent.owner, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, epoch: 1,
  authorizationRevisions: evidence.revisions
};
const applied: RecoveryRemoteProviderObservation = {
  kind: "applied", commandId: command.commandId, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, receiptId: "receipt-day71-evening"
};
const negative: RecoveryRemoteProviderObservation = {
  kind: "not_applied", commandId: command.commandId, effectId: intent.effectId,
  idempotencyKey: intent.idempotencyKey, noLateCommitGuarantee: false
};
const view = { status: "unknown" as const, epoch: 1 };
const plan = (observation: RecoveryRemoteProviderObservation | undefined) =>
  planUnknownRemoteEffectRecovery(intent, fence, view, strong.capabilities, observation);
expect("31. lost ACK with no evidence remains manual review",
  plan(undefined).action === "manual_review_required");
expect("32. trusted applied receipt is not yet a persisted business terminal",
  plan(applied).action === "verified_applied_requires_receipt_persistence");
expect("33. a non-final negative result cannot authorize a fresh claim",
  plan(negative).action === "manual_review_required");
expect("34. strong profile and probe do NOT change UNKNOWN no-auto-resend",
  review("provider-a", "reconcile_unknown_applied", "unknown").candidate &&
    !review("provider-a", "automatic_unknown_resend", "unknown").candidate);

check(count === 34, "all 34 checks ran");
console.log("Day 71 evening: 34/34 conformance, quarantine, phase and lost-ACK checks passed.");
console.log("No real provider calls, no incident durability, no automatic UNKNOWN resend.");
