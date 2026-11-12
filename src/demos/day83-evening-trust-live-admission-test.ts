import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecoveryWriterDurableTrustAdmissionGate } from "../runtime/recovery-writer-durable-trust-admission.js";
import { bootstrapRecoveredWriterTrust } from "../runtime/recovery-writer-durable-trust-bootstrap.js";
import { SQLiteRecoveryWriterTrustWatermarkStore } from "../runtime/recovery-writer-sqlite-trust-watermark-store.js";
import { RecoveryWriterRpcAdmissionHandler } from "../runtime/recovery-writer-rpc-admission.js";
import type { AuthenticatedRecoveryWriterPolicySource } from "../runtime/recovery-writer-trust-watermark-contract.js";

const dir = mkdtempSync(join(tmpdir(), "day83-evening-active-trust-"));
const dbFile = join(dir, "trust.db");
const deploymentId = "day83-lab";
const now = 1_000_000;
const fp1 = Array(32).fill("AA").join(":");
const fp2 = Array(32).fill("BB").join(":");
const encode = (revision: number, fingerprint256: string) => {
  const snapshot = {
    deploymentId, revision, issuedAtEpochMs: now, expiresAtEpochMs: now + 50_000,
    peers: [{ fingerprint256, subject: "svc:claim", grantedOperations: ["claim_outbox"] }]
  };
  const rawPolicyBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return {
    watermark: { deploymentId, revision, policySha256: createHash("sha256").update(rawPolicyBytes).digest("hex") },
    rawPolicyBytes
  };
};
const policy1 = encode(1, fp1);
const policy2 = encode(2, fp2);
let current = policy1;
let disconnected = false;
const source: AuthenticatedRecoveryWriterPolicySource = {
  getCurrent: async () => disconnected ? null : current
};
const a = new SQLiteRecoveryWriterTrustWatermarkStore(dbFile);
const b = new SQLiteRecoveryWriterTrustWatermarkStore(dbFile);
let delegateCalls = 0;
let audits = 0;
const caller = {
  subject: "svc:claim", mechanism: "mutual_tls", grantedOperations: ["claim_outbox"]
} as const;
const request = (id: string) => JSON.stringify({ requestId: id, operation: "claim_outbox", outboxId: "event:83" });

try {
  assert.equal(a.provisionTrustedAnchor(policy1.watermark), true);
  const boot1 = await bootstrapRecoveredWriterTrust({ deploymentId, source, store: a, nowEpochMs: () => now });
  assert.equal(boot1.action, "ready_for_isolated_bootstrap_test");
  if (boot1.action !== "ready_for_isolated_bootstrap_test") throw Error("boot1_failed");
  assert.equal(boot1.controller.resolve(fp1)?.subject, "svc:claim");
  const oldGate = new RecoveryWriterDurableTrustAdmissionGate({ deploymentId, bootstrap: boot1, store: a, source });
  const makeHandler = (gate: RecoveryWriterDurableTrustAdmissionGate, reauthorize = async () => true) =>
    new RecoveryWriterRpcAdmissionHandler({
      handle: async raw => {
        delegateCalls++;
        const id = JSON.parse(raw as string).requestId as string;
        return { requestId: id, action: "claimed", eventId: "event:83", leaseToken: "lab-only" };
      }
    }, {
      nowEpochMs: () => now, maxInFlightPerSubject: 1, replayTtlMs: 30_000,
      maxReplayKeys: 16, reauthorize, recordAudit: () => { audits++; },
      beforeDelegate: async () => gate.authorize()
    });
  const oldHandler = makeHandler(oldGate);
  assert.equal((await oldHandler.handle(request("one"), caller)).action, "claimed");
  assert.equal(delegateCalls, 1);

  // Shared SAME-SQLite transaction advances the authority while A stays alive.
  const expected = (await b.load(deploymentId))!;
  current = policy2;
  assert.equal(await b.compareAndSwap(expected, policy2.watermark), "advanced");
  assert.equal(boot1.controller.resolve(fp1)?.subject, "svc:claim",
    "old in-memory controller still holds old peer (counterexample)");
  const stale = await oldHandler.handle(request("stale"), caller);
  assert.equal(stale.action, "hold");
  if (stale.action === "hold") assert.equal(stale.reason, "durable_trust_stale_or_unavailable");
  assert.equal(delegateCalls, 1);
  assert.equal(audits, 1);

  // Recheck happens AFTER async ACL: a queued call cannot bypass a newer watermark.
  let release: (() => void) | undefined;
  const gateForQueued = new RecoveryWriterDurableTrustAdmissionGate({
    deploymentId, bootstrap: boot1, store: a, source
  });
  const queuedHandler = makeHandler(gateForQueued, async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return true;
  });
  const queued = queuedHandler.handle(request("queued"), caller);
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  assert.ok(release);
  release!();
  assert.equal((await queued).action, "hold");
  assert.equal(delegateCalls, 1);

  // Crash/restart after CAS: new controller can precisely recover revision 2.
  const boot2 = await bootstrapRecoveredWriterTrust({ deploymentId, source, store: a, nowEpochMs: () => now });
  assert.equal(boot2.action, "ready_for_isolated_bootstrap_test");
  if (boot2.action !== "ready_for_isolated_bootstrap_test") throw Error("boot2_failed");
  assert.equal(boot2.mode, "exact_restart_replay");
  assert.equal(boot2.controller.resolve(fp1), null);
  assert.equal(boot2.controller.resolve(fp2)?.subject, "svc:claim");
  const newGate = new RecoveryWriterDurableTrustAdmissionGate({ deploymentId, bootstrap: boot2, store: a, source });
  const newHandler = makeHandler(newGate);
  assert.equal((await newHandler.handle(request("fresh"), caller)).action, "claimed");
  assert.equal(delegateCalls, 2);

  disconnected = true;
  assert.equal((await newHandler.handle(request("offline"), caller)).action, "hold");
  disconnected = false;
  current = { ...policy2, rawPolicyBytes: new Uint8Array([123]) };
  assert.equal((await newHandler.handle(request("tampered"), caller)).action, "hold");
  current = policy1; // stale authenticated publisher / old rollback
  assert.equal((await newHandler.handle(request("rollback"), caller)).action, "hold");
  current = policy2;
  assert.equal(delegateCalls, 2);
  assert.equal(audits, 2);

  // The DB must be reachable: store outage must deny rather than reuse cached allow.
  a.close();
  assert.equal((await newHandler.handle(request("store-closed"), caller)).action, "hold");
  assert.equal(delegateCalls, 2);
  console.log("PASS Day 83 evening: live stale instance hold, queued ACL race, crash recovery, source outage, digest drift, rollback and store failure");
} finally {
  try { a.close(); } catch { /* closed by fault injection */ }
  b.close();
  rmSync(dir, { recursive: true, force: true });
}
