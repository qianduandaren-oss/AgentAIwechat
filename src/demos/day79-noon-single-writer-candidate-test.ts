import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConsumerAckEvidence } from "../runtime/recovery-outbox-ack-boundary.js";
import type { RecoveryOutboxRecord } from "../runtime/recovery-outbox.js";
import type { TrustedDispatcherCutoverEvidence } from "../runtime/recovery-dispatcher-cutover-policy.js";
import { SQLiteFencedOutboxDelivery } from "../runtime/recovery-fenced-outbox-delivery.js";
import { bootstrapSingleWriterCandidate } from "../runtime/recovery-single-writer-candidate-service.js";
import { RECOVERY_FINALIZATION_SCHEMA } from "../runtime/sqlite-recovery-finalization.js";

const dir = mkdtempSync(join(tmpdir(), "day79-noon-"));
const path = join(dir, "candidate.sqlite");
const now = Date.UTC(2026, 10, 8, 4);
const record: RecoveryOutboxRecord = {
  id: "cmd:terminal", eventId: "event:cmd", commandId: "cmd", runId: "run",
  kind: "audit", payload: "{}", status: "pending", attempts: 0, version: 1,
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
};
const admin = new DatabaseSync(path);
admin.exec(RECOVERY_FINALIZATION_SCHEMA);
admin.prepare("INSERT INTO recovery_outbox(id,event_id,command_id,run_id,payload,created_at) VALUES(?,?,?,?,?,?)")
  .run(record.id, record.eventId, record.commandId, record.runId, JSON.stringify(record), record.createdAt);
const a = new SQLiteFencedOutboxDelivery(path);
const b = new SQLiteFencedOutboxDelivery(path);
const all: TrustedDispatcherCutoverEvidence = {
  legacyDispatcherDisabled: true, rawAcknowledgeRestricted: true,
  verifiedAdapterConfigured: true, durableConsumerDedupeVerified: true,
  exclusiveSqliteWriter: true, noMixedVersionWorkers: true
};
let mixedVersion = false, evidenceDown = false;
let identity = {ownerId: "A", epoch: 0};
let currentTime = now;
let mode: "good" | "bad" | "wrong" | "race" = "good";
const verified: ConsumerAckEvidence = {
  eventId: record.eventId, outboxId: record.id, commandId: record.commandId,
  runId: record.runId, consumerId: "consumer-1", evidenceId: "receipt-1",
  observedAtEpochMs: now + 20
};
const deps = {
  store: a,
  cutoverEvidence: {collect: async () => {
    if (evidenceDown) throw Error("controller offline");
    return {...all, noMixedVersionWorkers: !mixedVersion};
  }},
  writerIdentity: {snapshot: async () => identity},
  verifiedAckAdapter: {verify: async (_raw: unknown): Promise<ConsumerAckEvidence | null> => {
    if (mode === "bad") return null;
    if (mode === "race") mixedVersion = true;
    return mode === "wrong" ? {...verified, consumerId: "forged"} : {...verified};
  }},
  consumer: {
    durableDedupeByEventId: true, dedupeRetentionSeconds: 7200,
    deliveryRecoveryWindowSeconds: 3600, authenticatedEventAck: true
  },
  consumerId: "consumer-1", clock: () => currentTime, leaseMs: 1000, maxEvidenceAgeMs: 30000
};
function action(result: {action: string}) { return result.action; }
try {
  identity = {...identity, epoch: a.rotate("A")};
  mixedVersion = true;
  const failed = await bootstrapSingleWriterCandidate(deps);
  assert.equal(failed.action, "hold");
  assert.equal(failed.publishAuthorized, false);
  assert.equal("service" in failed, false);
  mixedVersion = false;

  const boot = await bootstrapSingleWriterCandidate(deps);
  assert.equal(boot.action, "ready_for_candidate_tests");
  assert.equal(boot.publishAuthorized, false);
  if (boot.action !== "ready_for_candidate_tests") throw Error("unexpected hold");
  const service = boot.service;
  const claim = await service.claimOutbox({outboxId: record.id});
  assert.equal(action(claim), "claimed");
  if (claim.action !== "claimed") throw Error("claim failed");

  mode = "bad";
  assert.equal(action(await service.confirmOutbox({
    outboxId: record.id, eventId: record.eventId, leaseToken: claim.leaseToken, rawConsumerResponse: {}
  })), "hold");
  assert.equal(a.inspect(record.id)?.status, "pending");

  mode = "wrong";
  assert.equal(action(await service.confirmOutbox({
    outboxId: record.id, eventId: record.eventId, leaseToken: claim.leaseToken, rawConsumerResponse: {}
  })), "hold");

  mode = "race";
  const race = await service.confirmOutbox({
    outboxId: record.id, eventId: record.eventId, leaseToken: claim.leaseToken, rawConsumerResponse: {}
  });
  assert.equal(race.action, "hold"); // post-auth check catches mixed-version rollout
  mixedVersion = false;
  mode = "good";

  evidenceDown = true;
  assert.equal(action(await service.claimOutbox({outboxId: record.id})), "hold");
  evidenceDown = false;

  identity = {...identity, epoch: b.rotate("B")}; // A's lease is no longer writable by A
  const staleA = {...identity, ownerId: "A", epoch: 1};
  identity = staleA;
  assert.equal(action(await service.confirmOutbox({
    outboxId: record.id, eventId: record.eventId, leaseToken: claim.leaseToken, rawConsumerResponse: {}
  })), "hold");
  assert.equal(a.inspect(record.id)?.status, "pending");

  identity = {ownerId: "B", epoch: 2};
  currentTime = now + 1000; // old lease expired
  const second = await service.claimOutbox({outboxId: record.id});
  assert.equal(action(second), "claimed");
  if (second.action !== "claimed") throw Error("new claim failed");
  currentTime = now + 1010;
  assert.deepEqual(await service.confirmOutbox({
    outboxId: record.id, eventId: record.eventId, leaseToken: second.leaseToken, rawConsumerResponse: {}
  }), {action: "dispatched", eventId: record.eventId});
  assert.equal(a.inspect(record.id)?.status, "dispatched");

  assert.equal(action(await service.claimOutbox({outboxId: record.id})), "already_dispatched");
  console.log("PASS Day 79 candidate bootstrap, recheck, verified ACK, stale fence and takeover");
} finally {
  a.close(); b.close(); admin.close(); rmSync(dir, {recursive: true, force: true});
}
