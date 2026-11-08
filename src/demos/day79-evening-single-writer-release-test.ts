import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import {
  SINGLE_WRITER_RELEASE_PROOFS,
  reviewSingleWriterReleaseEvidence,
  type SingleWriterReleaseEvidence,
  type SingleWriterProofKey
} from "../runtime/recovery-single-writer-release-review.js";
import { CutoverEvidenceGuard } from "../runtime/recovery-cutover-evidence-guard.js";
import type { TrustedDispatcherCutoverEvidence } from "../runtime/recovery-dispatcher-cutover-policy.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";

const now = Date.UTC(2026, 10, 8, 10);
const deploymentId = "staging-writer-2026-11-08";
const proofKeys = Object.keys(SINGLE_WRITER_RELEASE_PROOFS) as SingleWriterProofKey[];
const good = (): SingleWriterReleaseEvidence => ({
  deploymentId,
  proofs: Object.fromEntries(proofKeys.map(key => [key, {
    outcome: "pass", method: SINGLE_WRITER_RELEASE_PROOFS[key],
    deploymentId, observedAtEpochMs: now, attestor: "trusted-staging-probe"
  }]))
});
const review = (e: SingleWriterReleaseEvidence) =>
  reviewSingleWriterReleaseEvidence(e, now, 30_000);
function reason(e: SingleWriterReleaseEvidence): string {
  const result = review(e);
  assert.equal(result.action, "hold");
  return result.action === "hold" ? result.reason : "";
}

// These are fabricated TEST FIXTURES; they do not prove deployment isolation.
assert.deepEqual(review(good()), {
  action: "ready_for_external_security_review", publishAuthorized: false
});
for (const key of proofKeys) {
  const missing = good();
  delete missing.proofs[key]; // Partial proof map
  assert.equal(reason(missing), `missing_proof:${key}`);

  const failed = good();
  failed.proofs[key] = {...failed.proofs[key]!, outcome: "fail"};
  assert.equal(reason(failed), `failed_proof:${key}`);
}
const stale = good();
stale.proofs.legacyProcessDbWriteDenied = {
  ...stale.proofs.legacyProcessDbWriteDenied!, observedAtEpochMs: now - 30_001
};
assert.equal(reason(stale), "stale_proof:legacyProcessDbWriteDenied");
const future = good();
future.proofs.legacyProcessDbWriteDenied = {
  ...future.proofs.legacyProcessDbWriteDenied!, observedAtEpochMs: now + 1
};
assert.equal(reason(future), "stale_proof:legacyProcessDbWriteDenied");
const wrongDeployment = good();
wrongDeployment.proofs.legacyProcessDbWriteDenied = {
  ...wrongDeployment.proofs.legacyProcessDbWriteDenied!, deploymentId: "rollback-old"
};
assert.equal(reason(wrongDeployment), "unbound_proof:legacyProcessDbWriteDenied");
const wrongMethod = good();
wrongMethod.proofs.rollbackRetainsDbDeny = {
  ...wrongMethod.proofs.rollbackRetainsDbDeny!, method: "integration_test"
};
assert.equal(reason(wrongMethod), "wrong_method:rollbackRetainsDbDeny");
assert.equal(reviewSingleWriterReleaseEvidence(null, now, 30_000).action, "hold");
assert.equal(reviewSingleWriterReleaseEvidence(good(), now, 0).action, "hold");

const cutover: TrustedDispatcherCutoverEvidence = {
  legacyDispatcherDisabled: true, rawAcknowledgeRestricted: true,
  verifiedAdapterConfigured: true, durableConsumerDedupeVerified: true,
  exclusiveSqliteWriter: true, noMixedVersionWorkers: true
};
let rollbackRestartsLegacy = false;
const guard = new CutoverEvidenceGuard({
  collect: async () => ({...cutover, noMixedVersionWorkers: !rollbackRestartsLegacy})
});
async function run() {
  assert.equal((await guard.check()).action, "allow_candidate");
  rollbackRestartsLegacy = true;
  assert.deepEqual(await guard.check(), {action: "hold", reason: "noMixedVersionWorkers"});
  rollbackRestartsLegacy = false;

  // Real SQLite counterexample: a legacy connection still holding file write
  // access bypasses every application-level epoch/lease/ACK check.
  const dir = mkdtempSync(join(tmpdir(), "day79-evening-"));
  const file = join(dir, "recovery.sqlite");
  const admin = new DatabaseSync(file);
  let candidate: SQLiteFencedOutboxDelivery | undefined;
  try {
    admin.exec(RECOVERY_FINALIZATION_SCHEMA);
    const item: RecoveryOutboxRecord = {
      id: "cmd:evening", eventId: "event:evening",
      commandId: "cmd", runId: "run",
      kind: "audit", payload: "{}", status: "pending",
      attempts: 0, version: 1,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
      .run(item.id, item.eventId, item.commandId, item.runId, JSON.stringify(item), item.createdAt);
    candidate = new SQLiteFencedOutboxDelivery(file);
    candidate.rotate("A");
    candidate.rotate("B"); // Old A is fenced on all guarded APIs.
    const original = candidate.inspect(item.id);
    assert.ok(original);
    admin.prepare("UPDATE recovery_outbox SET payload=? WHERE id=?")
      .run(JSON.stringify({...original, status: "dispatched", version: original.version + 1}), item.id);
    assert.equal(candidate.inspect(item.id)?.status, "dispatched");
    // No boolean, mocked probe, or feature flag can revoke this OS-level access.
    assert.equal(review(good()).publishAuthorized, false);
    console.log("PASS Day 79 release proofs fail closed, rollback guard, real SQLite bypass; production NO_GO");
  } finally {
    candidate?.close();
    admin.close();
    rmSync(dir, {recursive: true, force: true});
  }
}
await run();
