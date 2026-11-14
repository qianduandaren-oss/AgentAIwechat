import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import { RecoveryWriterTrustFenceConflict } from "../runtime/recovery-writer-transactional-trust-contract.js";
import { SQLiteRecoveryWriterTrustWatermarkStore } from "../runtime/recovery-writer-sqlite-trust-watermark-store.js";
import { createIsolatedTrustBoundRecoveryWriter } from "../runtime/recovery-writer-isolated-trust-bound-factory.js";
import type {
  AuthenticatedRecoveryWriterPolicySource
} from "../runtime/recovery-writer-trust-watermark-contract.js";

const dir = mkdtempSync(join(tmpdir(), "day85-noon-factory-"));
const dbPath = join(dir, "candidate.sqlite");
const deploymentId = "staging:day85-noon";
const now = Date.UTC(2026, 10, 14, 4);
const fingerprint256 = Array(32).fill("AA").join(":");
function policyAt(revision: number) {
  const snapshot = {
    deploymentId, revision,
    issuedAtEpochMs: now - 1000, expiresAtEpochMs: now + 60000,
    peers: [{ fingerprint256, subject: "svc:claim", grantedOperations: ["claim_outbox"] }]
  };
  const rawPolicyBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return {
    watermark: {
      deploymentId, revision,
      policySha256: createHash("sha256").update(rawPolicyBytes).digest("hex")
    },
    rawPolicyBytes
  };
}
let current = policyAt(1);
let disconnected = false;
const source: AuthenticatedRecoveryWriterPolicySource = {
  // LAB STUB ONLY. Production must independently authenticate publisher.
  getCurrent: async () => disconnected ? null : current
};
const store = new SQLiteRecoveryWriterTrustWatermarkStore(dbPath);
const admin = new DatabaseSync(dbPath);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
const record = (id: string): RecoveryOutboxRecord => ({
  id: "cmd:" + id, eventId: "event:" + id,
  commandId: "cmd:" + id, runId: "run:85",
  kind: "audit", payload: "{}", status: "pending",
  attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
});
for (const entry of [record("a"), record("b")]) {
  admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
    .run(entry.id, entry.eventId, entry.commandId, entry.runId, JSON.stringify(entry), entry.createdAt);
}
const consumer = {
  durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
  deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
};
const input = {
  intent: "isolated_candidate" as const, dbPath, deploymentId,
  source, store, nowEpochMs: () => now
};
let firstWriter: import("../runtime/recovery-fenced-outbox-delivery.js").SQLiteFencedOutboxDelivery | undefined;
let secondWriter: import("../runtime/recovery-fenced-outbox-delivery.js").SQLiteFencedOutboxDelivery | undefined;
try {
  // No Trust-on-First-Use: even a well-formed Source cannot create a writer.
  const noAnchor = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(noAnchor.action, "hold");
  if (noAnchor.action === "hold") assert.equal(noAnchor.reason, "durable_trust_anchor_unavailable");

  assert.equal(store.provisionTrustedAnchor(current.watermark), true);
  const production = await createIsolatedTrustBoundRecoveryWriter({
    ...input, intent: "production_release"
  });
  assert.equal(production.action, "hold");
  if (production.action === "hold") {
    assert.equal(production.reason, "production_or_invalid_intent_forbidden");
  }
  const blank = await createIsolatedTrustBoundRecoveryWriter({ ...input, dbPath: "" });
  assert.equal(blank.action, "hold");

  // Policy/bootstrap may be valid for one DB, but another DB without the
  // authoritative watermark cannot be exposed via the strict factory.
  const otherDb = await createIsolatedTrustBoundRecoveryWriter({
    ...input, dbPath: join(dir, "different.sqlite")
  });
  assert.equal(otherDb.action, "hold");
  if (otherDb.action === "hold") assert.equal(otherDb.reason, "writer_database_trust_unavailable");

  const first = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(first.action, "ready_for_isolated_factory_test");
  if (first.action !== "ready_for_isolated_factory_test") throw Error("factory first hold");
  firstWriter = first.writer;
  assert.equal(first.publishAuthorized, false);
  assert.equal(first.activeWatermark.revision, 1);
  assert.ok(Object.isFrozen(first.activeWatermark));
  const epochA = firstWriter.rotate("worker-A");
  const firstClaim = firstWriter.claim({
    outboxId: "cmd:a", workerId: "worker-A", epoch: epochA,
    consumer, nowEpochMs: now, leaseMs: 5000
  });
  assert.equal(firstClaim.action, "claimed");

  // Advance trust through the existing SQLite CAS. Old runtime must lose.
  const next = policyAt(2);
  assert.equal(await store.compareAndSwap(current.watermark, next.watermark), "advanced");
  assert.throws(() => firstWriter!.rotate("worker-A"), (error: unknown) =>
    error instanceof RecoveryWriterTrustFenceConflict &&
    error.reason === "stale_trust_revision_fenced");

  // Old policy cannot bootstrap again, even if source still serves its bytes.
  const oldSource = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(oldSource.action, "hold");
  if (oldSource.action === "hold") assert.equal(oldSource.reason, "trust_policy_rollback");

  current = next;
  disconnected = true;
  const sourceOffline = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(sourceOffline.action, "hold");
  if (sourceOffline.action === "hold") assert.equal(sourceOffline.reason, "trusted_policy_source_unavailable");
  disconnected = false;
  const currentValid = current;
  current = { ...currentValid, rawPolicyBytes: new TextEncoder().encode("{}") };
  const corrupted = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(corrupted.action, "hold");
  if (corrupted.action === "hold") assert.equal(corrupted.reason, "trusted_policy_digest_mismatch");
  current = currentValid;

  const second = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(second.action, "ready_for_isolated_factory_test");
  if (second.action !== "ready_for_isolated_factory_test") throw Error("factory second hold");
  secondWriter = second.writer;
  const epochB = secondWriter.rotate("worker-B");
  const secondClaim = secondWriter.claim({
    outboxId: "cmd:b", workerId: "worker-B", epoch: epochB,
    consumer, nowEpochMs: now + 1, leaseMs: 5000
  });
  assert.equal(secondClaim.action, "claimed");
  if (secondClaim.action !== "claimed") throw Error("missing lease");
  assert.equal(secondWriter.acknowledge({
    outboxId: "cmd:b", eventId: "event:b", workerId: "worker-B",
    epoch: epochB, leaseToken: secondClaim.leaseToken, nowEpochMs: now + 2
  }).action, "dispatched");

  // Reopening an exact, current revision is allowed for isolated restart.
  secondWriter.close(); secondWriter = undefined;
  const restart = await createIsolatedTrustBoundRecoveryWriter(input);
  assert.equal(restart.action, "ready_for_isolated_factory_test");
  if (restart.action !== "ready_for_isolated_factory_test") throw Error("factory restart hold");
  secondWriter = restart.writer;
  assert.equal(secondWriter.inspect("cmd:b")?.status, "dispatched");

  console.log("PASS Day 85 noon: strict isolated factory, no TOFU, same-DB startup check, stale/invalid source denial, rotate/claim/ACK and restart; production NO_GO");
} finally {
  firstWriter?.close();
  secondWriter?.close();
  admin.close(); store.close();
  rmSync(dir, { recursive: true, force: true });
}
